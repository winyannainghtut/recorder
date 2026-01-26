package main

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	// Config
	maxUploadSize    = 2 * 1024 * 1024 * 1024 // 2GB - supports 3-hour recordings
	tempDir          = "/tmp/videos"
	ttlDuration      = 60 * time.Minute       // Auto-delete after 1 hour (more time for large files)
	cleanupInterval  = 1 * time.Minute        // Run cleanup every minute
	authTokenHeader  = "X-Auth-Token"

	// Rate limiting
	rateLimit        = 10               // Max uploads per IP per minute
	rateLimitWindow  = 1 * time.Minute  // Rate limit window

	// Content types
	contentTypeWebM = "video/webm"
)

// TokenInfo stores metadata about a recording
type TokenInfo struct {
	Filename     string
	CreatedAt    time.Time
	ExpiresAt    time.Time
	ContentType  string
	Downloaded   bool
	FileSize     int64
}

// RateLimitEntry tracks requests per IP
type RateLimitEntry struct {
	Count     int
	ResetTime time.Time
}

// Server holds the application state
type Server struct {
	tokens     map[string]*TokenInfo
	mu         sync.RWMutex
	rateLimits map[string]*RateLimitEntry
	rlMu       sync.Mutex
}

func main() {
	// Ensure temp directory exists
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		log.Fatalf("Failed to create temp directory: %v", err)
	}

	server := &Server{
		tokens:     make(map[string]*TokenInfo),
		rateLimits: make(map[string]*RateLimitEntry),
	}

	// Start cleanup goroutine
	go server.cleanupExpiredFiles()

	// Setup routes
	r := http.NewServeMux()
	r.HandleFunc("/upload", server.handleUpload)
	r.HandleFunc("/download/", server.handleDownload)
	r.HandleFunc("/healthz", server.handleHealth)
	r.HandleFunc("/", server.handleStatic)

	// Start server
	port := ":8080"
	log.Printf("Starting server on %s", port)
	log.Printf("Using temp directory: %s", tempDir)
	log.Printf("Max upload size: %d bytes", maxUploadSize)

	if err := http.ListenAndServe(port, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// cleanupExpiredFiles removes expired and downloaded files
func (s *Server) cleanupExpiredFiles() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		s.mu.Lock()
		now := time.Now()

		for token, info := range s.tokens {
			// Delete if expired or already downloaded
			if now.After(info.ExpiresAt) || info.Downloaded {
				s.deleteFile(info.Filename)
				delete(s.tokens, token)
				log.Printf("Cleaned up token %s (expired: %v, downloaded: %v)",
					token, now.After(info.ExpiresAt), info.Downloaded)
			}
		}

		s.mu.Unlock()
	}
}

// deleteFile removes the temp file
func (s *Server) deleteFile(filename string) {
	filePath := filepath.Join(tempDir, filename)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		log.Printf("Error deleting file %s: %v", filename, err)
	}
}

// handleHealth responds to health checks
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

// handleStatic serves the frontend
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}

	// Serve from embedded frontend directory
	filePath := filepath.Join("/app/frontend", path)
	http.ServeFile(w, r, filePath)
}

// handleUpload processes video uploads
func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Rate limit check
	clientIP := getClientIP(r)
	if !s.checkRateLimit(clientIP) {
		http.Error(w, "Rate limit exceeded. Try again later.", http.StatusTooManyRequests)
		return
	}

	// Optional auth token check
	authToken := r.Header.Get(authTokenHeader)
	expectedToken := os.Getenv("AUTH_TOKEN")
	if expectedToken != "" && authToken != expectedToken {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse multipart form with size limit
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		if err.Error() == "http: request body too large" {
			http.Error(w, "File too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "Invalid form data", http.StatusBadRequest)
		return
	}

	// Get file
	file, header, err := r.FormFile("video")
	if err != nil {
		http.Error(w, "No video file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Validate content type
	if !strings.HasPrefix(header.Header.Get("Content-Type"), "video/") {
		http.Error(w, "Invalid file type", http.StatusBadRequest)
		return
	}

	// Generate unique token
	token, err := generateToken()
	if err != nil {
		log.Printf("Error generating token: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Create temp file
	filename := fmt.Sprintf("%s.webm", token)
	filePath := filepath.Join(tempDir, filename)
	tempFile, err := os.Create(filePath)
	if err != nil {
		log.Printf("Error creating temp file: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	defer tempFile.Close()

	// Stream file to disk (no full file in RAM)
	written, err := io.Copy(tempFile, file)
	if err != nil {
		os.Remove(filePath)
		log.Printf("Error writing file: %v", err)
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}

	// Store token info
	s.mu.Lock()
	s.tokens[token] = &TokenInfo{
		Filename:    filename,
		CreatedAt:   time.Now(),
		ExpiresAt:   time.Now().Add(ttlDuration),
		ContentType: contentTypeWebM,
		FileSize:    written,
		Downloaded:  false,
	}
	s.mu.Unlock()

	log.Printf("Uploaded: %s (size: %d bytes, expires: %v)",
		filename, written, time.Now().Add(ttlDuration))

	// Return token
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	fmt.Fprintf(w, `{"token":"%s","expiresAt":"%s"}`,
		token, time.Now().Add(ttlDuration).Format(time.RFC3339))
}

// handleDownload processes one-time downloads
func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract token from path
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) != 3 {
		http.Error(w, "Invalid download URL", http.StatusBadRequest)
		return
	}
	token := parts[2]

	s.mu.Lock()
	info, exists := s.tokens[token]

	// Check if token exists
	if !exists {
		s.mu.Unlock()
		http.Error(w, "Download link expired or invalid", http.StatusNotFound)
		return
	}

	// Check if already downloaded
	if info.Downloaded {
		delete(s.tokens, token)
		s.mu.Unlock()
		http.Error(w, "Download link already used", http.StatusGone)
		return
	}

	// Check if expired
	if time.Now().After(info.ExpiresAt) {
		s.deleteFile(info.Filename)
		delete(s.tokens, token)
		s.mu.Unlock()
		http.Error(w, "Download link expired", http.StatusGone)
		return
	}

	// Mark as downloaded
	info.Downloaded = true
	s.mu.Unlock()

	// Open file
	filePath := filepath.Join(tempDir, info.Filename)
	file, err := os.Open(filePath)
	if err != nil {
		log.Printf("Error opening file: %v", err)
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	defer file.Close()

	// Stream file to client (no full file in RAM)
	w.Header().Set("Content-Type", info.ContentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="recording_%s.webm"`, time.Now().Format("20060102_150405")))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.FileSize))
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")

	if _, err := io.Copy(w, file); err != nil {
		log.Printf("Error streaming file: %v", err)
		return
	}

	log.Printf("Downloaded: %s (token: %s)", info.Filename, token)
}

// generateToken creates a secure random token
func generateToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// checkRateLimit returns true if the request should be allowed
func (s *Server) checkRateLimit(ip string) bool {
	s.rlMu.Lock()
	defer s.rlMu.Unlock()

	now := time.Now()
	entry, exists := s.rateLimits[ip]

	if !exists || now.After(entry.ResetTime) {
		s.rateLimits[ip] = &RateLimitEntry{
			Count:     1,
			ResetTime: now.Add(rateLimitWindow),
		}
		return true
	}

	if entry.Count >= rateLimit {
		return false
	}

	entry.Count++
	return true
}

// getClientIP extracts the client IP from the request
func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For header (for proxies/load balancers)
	xff := r.Header.Get("X-Forwarded-For")
	if xff != "" {
		ips := strings.Split(xff, ",")
		return strings.TrimSpace(ips[0])
	}
	// Check X-Real-IP header
	xri := r.Header.Get("X-Real-IP")
	if xri != "" {
		return xri
	}
	// Fall back to RemoteAddr
	ip := r.RemoteAddr
	// Remove port if present
	if colonIdx := strings.LastIndex(ip, ":"); colonIdx != -1 {
		ip = ip[:colonIdx]
	}
	return ip
}

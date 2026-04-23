package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	// Session config
	sessionCookieName = "session_token"
	sessionDuration   = 24 * time.Hour // Session lasts 24 hours
)

// Session stores user session info
type Session struct {
	Token     string
	CreatedAt time.Time
	ExpiresAt time.Time
	IP        string
}

// Server holds the application state
type Server struct {
	sessions map[string]*Session
	sessMu   sync.RWMutex
}

func main() {
	// Check if LOGIN_PASSWORD is set
	loginPassword := os.Getenv("LOGIN_PASSWORD")
	if loginPassword == "" {
		log.Println("WARNING: LOGIN_PASSWORD not set - authentication disabled")
	} else {
		log.Println("Authentication enabled")
	}

	server := &Server{
		sessions: make(map[string]*Session),
	}

	// Start cleanup goroutine
	go server.cleanupExpiredSessions()

	// Setup routes
	r := http.NewServeMux()

	// Auth routes (no auth required)
	r.HandleFunc("/auth/login", server.handleLogin)
	r.HandleFunc("/auth/logout", server.handleLogout)
	r.HandleFunc("/login", server.handleLoginPage)

	// Health check (no auth required)
	r.HandleFunc("/healthz", server.handleHealth)

	r.HandleFunc("/", server.handleStatic)

	// Start server
	port := ":8080"
	log.Printf("Starting server on %s", port)

	if err := http.ListenAndServe(port, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// cleanupExpiredSessions removes expired sessions
func (s *Server) cleanupExpiredSessions() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		s.sessMu.Lock()
		now := time.Now()
		for token, session := range s.sessions {
			if now.After(session.ExpiresAt) {
				delete(s.sessions, token)
				log.Printf("Cleaned up expired session")
			}
		}
		s.sessMu.Unlock()
	}
}

// isAuthenticated checks if the request has a valid session
func (s *Server) isAuthenticated(r *http.Request) bool {
	// If no password set, allow all
	if os.Getenv("LOGIN_PASSWORD") == "" {
		return true
	}

	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return false
	}

	s.sessMu.RLock()
	session, exists := s.sessions[cookie.Value]
	s.sessMu.RUnlock()

	if !exists {
		return false
	}

	// Check expiration
	if time.Now().After(session.ExpiresAt) {
		s.sessMu.Lock()
		delete(s.sessions, cookie.Value)
		s.sessMu.Unlock()
		return false
	}

	return true
}

// handleLoginPage serves the login page
func (s *Server) handleLoginPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// If already authenticated, redirect to main app
	if s.isAuthenticated(r) {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}

	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	filePath := filepath.Join("/app/frontend", "login.html")
	http.ServeFile(w, r, filePath)
}

// handleLogin processes login requests
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var loginReq struct {
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&loginReq); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Get expected password
	expectedPassword := os.Getenv("LOGIN_PASSWORD")
	if expectedPassword == "" {
		// No password set, create session anyway
		s.createSession(w, r)
		return
	}

	// Constant-time comparison to prevent timing attacks
	if subtle.ConstantTimeCompare([]byte(loginReq.Password), []byte(expectedPassword)) != 1 {
		log.Printf("Failed login attempt from %s", getClientIP(r))
		http.Error(w, "Invalid password", http.StatusUnauthorized)
		return
	}

	// Create session
	s.createSession(w, r)
	log.Printf("Successful login from %s", getClientIP(r))
}

// createSession creates a new session and sets the cookie
func (s *Server) createSession(w http.ResponseWriter, r *http.Request) {
	// Generate session token
	token, err := generateToken()
	if err != nil {
		log.Printf("Error generating session token: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Create session
	session := &Session{
		Token:     token,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(sessionDuration),
		IP:        getClientIP(r),
	}

	// Store session
	s.sessMu.Lock()
	s.sessions[token] = session
	s.sessMu.Unlock()

	// Set cookie
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  session.ExpiresAt,
		HttpOnly: true,
		Secure:   true, // Only send over HTTPS
		SameSite: http.SameSiteStrictMode,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"success":true}`)
}

// handleLogout clears the session
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookieName)
	if err == nil {
		s.sessMu.Lock()
		delete(s.sessions, cookie.Value)
		s.sessMu.Unlock()
	}

	// Clear the cookie
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})

	http.Redirect(w, r, "/login", http.StatusFound)
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

	// Check authentication for main app pages (not static assets)
	if path == "/index.html" || path == "/" {
		if !s.isAuthenticated(r) {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
	}

	// Set cache control headers to prevent CDN caching issues
	// For JS/CSS files, prevent caching to ensure updates are served immediately
	if strings.HasSuffix(path, ".js") || strings.HasSuffix(path, ".css") {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
	} else if strings.HasSuffix(path, ".html") {
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
	}

	// Serve from embedded frontend directory
	filePath := filepath.Join("/app/frontend", path)
	http.ServeFile(w, r, filePath)
}

// generateToken creates a secure random token
func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
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

	// Fall back to RemoteAddr and handle both IPv4 and IPv6 safely.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		// If parsing fails, return the raw value (it may already be just an IP).
		return r.RemoteAddr
	}

	return host
}

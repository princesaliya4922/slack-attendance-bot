package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/princesaliya4922/slack-attendance-bot/internal/slack"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: No .env file found")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	// Initialize router
	router := mux.NewRouter()
	router.HandleFunc("/slack/events", slack.HandleSlackEvents).Methods("POST")

	// Start server
	fmt.Println("Server running on port", port)
	log.Fatal(http.ListenAndServe(":"+port, router))
}

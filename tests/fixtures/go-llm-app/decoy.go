package main

import "fmt"

// DECOY: a generic .Create() and fmt.Println must not register as AI surfaces;
// NewClient is only an LLM surface for a known SDK package operand.
type DB struct{}

func (d *DB) Create(user string) {}

func CreateUser(db *DB, user string) {
	db.Create(user)
	fmt.Println("created", user)
}

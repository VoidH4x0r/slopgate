package demo

import "testing"

func TestSomething(t *testing.T) {
	if 1+1 != 2 {
		t.Fatal("math is broken")
	}
}

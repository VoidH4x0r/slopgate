package demo

func duplicateB(x int) int {
	y := x + 1
	if y > 10 {
		y = y * 2
	}
	y += 3
	return y
}

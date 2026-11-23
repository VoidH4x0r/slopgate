package demo

func unreachable() int {
	return 1
	fmt.Println("dead")
}

func stub() {
	panic("not implemented")
}

func swallowed() error {
	var err error
	if err != nil {
	}
	return nil
}

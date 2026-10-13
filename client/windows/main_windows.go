//go:build windows

// The Windows client opens the remote Galene site in a browser application
// window. It is not an embedded server or an alternative WebRTC engine.
package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const (
	wsOverlappedWindow = 0x00CF0000
	wsVisible          = 0x10000000
	wsChild            = 0x40000000
	wsTabStop          = 0x00010000
	wsBorder           = 0x00800000
	esAutoHScroll      = 0x0080
	bsDefPushButton    = 0x0001
	wsExClientEdge     = 0x00000200

	wmCreate  = 0x0001
	wmDestroy = 0x0002
	wmCommand = 0x0111
	wmSetFont = 0x0030

	inputID  = 101
	launchID = 102
)

type wndClassEx struct {
	size       uint32
	style      uint32
	wndProc    uintptr
	classExtra int32
	wndExtra   int32
	instance   uintptr
	icon       uintptr
	cursor     uintptr
	background uintptr
	menuName   *uint16
	className  *uint16
	iconSmall  uintptr
}

type point struct {
	x int32
	y int32
}

type message struct {
	hwnd    uintptr
	msg     uint32
	wparam  uintptr
	lparam  uintptr
	time    uint32
	pt      point
	private uint32
}

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")

	registerClass       = user32.NewProc("RegisterClassExW")
	createWindow        = user32.NewProc("CreateWindowExW")
	defWindowProc       = user32.NewProc("DefWindowProcW")
	showWindow          = user32.NewProc("ShowWindow")
	updateWindow        = user32.NewProc("UpdateWindow")
	setFocus            = user32.NewProc("SetFocus")
	getMessage          = user32.NewProc("GetMessageW")
	translateMessage    = user32.NewProc("TranslateMessage")
	dispatchMessage     = user32.NewProc("DispatchMessageW")
	postQuit            = user32.NewProc("PostQuitMessage")
	destroyWindow       = user32.NewProc("DestroyWindow")
	getWindowTextLength = user32.NewProc("GetWindowTextLengthW")
	getWindowText       = user32.NewProc("GetWindowTextW")
	messageBox          = user32.NewProc("MessageBoxW")
	sendMessage         = user32.NewProc("SendMessageW")
	loadCursor          = user32.NewProc("LoadCursorW")
	getSystemMetrics    = user32.NewProc("GetSystemMetrics")

	getModuleHandle = kernel32.NewProc("GetModuleHandleW")
	getStockObject  = gdi32.NewProc("GetStockObject")

	hInstance uintptr
	hInput    uintptr
	guiFont   uintptr
)

func utf16(s string) *uint16 {
	p, err := syscall.UTF16PtrFromString(s)
	if err != nil {
		panic(err)
	}
	return p
}

func makeControl(class, label string, style uintptr, x, y, w, h, id int, parent uintptr) uintptr {
	handle, _, _ := createWindow.Call(0, uintptr(unsafe.Pointer(utf16(class))),
		uintptr(unsafe.Pointer(utf16(label))), style|wsVisible|wsChild,
		uintptr(x), uintptr(y), uintptr(w), uintptr(h),
		parent, uintptr(id), hInstance, 0)
	if handle != 0 && guiFont != 0 {
		sendMessage.Call(handle, wmSetFont, guiFont, 1)
	}
	return handle
}

func readInput() string {
	length, _, _ := getWindowTextLength.Call(hInput)
	if length > 4096 {
		length = 4096
	}
	buffer := make([]uint16, length+1)
	getWindowText.Call(hInput, uintptr(unsafe.Pointer(&buffer[0])), length+1)
	return syscall.UTF16ToString(buffer)
}

func showError(hwnd uintptr, text string) {
	messageBox.Call(hwnd, uintptr(unsafe.Pointer(utf16(text))),
		uintptr(unsafe.Pointer(utf16("Cat-galene 客户端"))), 0x10)
}

func windowProcedure(hwnd, msg, wparam, lparam uintptr) uintptr {
	switch msg {
	case wmCreate:
		guiFont, _, _ = getStockObject.Call(17) // DEFAULT_GUI_FONT
		makeControl("STATIC", "连接到 Linux 会议服务器", 0, 25, 22, 520, 26, 0, hwnd)
		makeControl("STATIC", "输入完整会议链接（HTTPS），例如：https://meet.example.com/group/team/", 0,
			25, 58, 535, 25, 0, hwnd)
		hInput = makeControl("EDIT", lastServer(), wsTabStop|wsBorder|esAutoHScroll|wsExClientEdge,
			25, 90, 535, 31, inputID, hwnd)
		makeControl("BUTTON", "进入会议", wsTabStop|bsDefPushButton,
			385, 137, 175, 40, launchID, hwnd)
		makeControl("STATIC", "使用系统 Edge / Chrome，摄像头与屏幕共享由浏览器管理", 0,
			25, 185, 530, 25, 0, hwnd)
		return 0
	case wmCommand:
		if wparam&0xffff == launchID {
			if err := openMeeting(readInput()); err != nil {
				showError(hwnd, err.Error())
			} else {
				destroyWindow.Call(hwnd)
			}
			return 0
		}
	case wmDestroy:
		postQuit.Call(0)
		return 0
	}
	result, _, _ := defWindowProc.Call(hwnd, msg, wparam, lparam)
	return result
}

func runWindow() error {
	hInstance, _, _ = getModuleHandle.Call(0)
	if hInstance == 0 {
		return fmt.Errorf("无法初始化 Windows 客户端")
	}
	className := utf16("CatGaleneClientWindow")
	cursor, _, _ := loadCursor.Call(0, 32512) // IDC_ARROW
	class := wndClassEx{
		size:       uint32(unsafe.Sizeof(wndClassEx{})),
		style:      0x0003, // CS_HREDRAW | CS_VREDRAW
		wndProc:    syscall.NewCallback(windowProcedure),
		instance:   hInstance,
		cursor:     cursor,
		background: 6, // COLOR_WINDOW + 1
		className:  className,
	}
	if r, _, _ := registerClass.Call(uintptr(unsafe.Pointer(&class))); r == 0 {
		return fmt.Errorf("无法注册 Windows 窗口")
	}
	width, height := 600, 270
	sw, _, _ := getSystemMetrics.Call(0) // SM_CXSCREEN
	sh, _, _ := getSystemMetrics.Call(1) // SM_CYSCREEN
	x, y := (int(sw)-width)/2, (int(sh)-height)/2
	window, _, _ := createWindow.Call(0, uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16("Cat-galene · Windows 会议客户端"))),
		wsOverlappedWindow|wsVisible, uintptr(x), uintptr(y),
		uintptr(width), uintptr(height), 0, 0, hInstance, 0)
	if window == 0 {
		return fmt.Errorf("无法创建 Windows 窗口")
	}
	showWindow.Call(window, 1)
	updateWindow.Call(window)
	setFocus.Call(hInput)
	for {
		var m message
		r, _, _ := getMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if r == 0 {
			return nil
		}
		if r == ^uintptr(0) {
			return fmt.Errorf("Windows 消息循环失败")
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&m)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "-version" {
		fmt.Println("Cat-galene Windows Client v1.2.1-cat.3")
		return
	}
	if err := runWindow(); err != nil {
		showError(0, err.Error())
		os.Exit(1)
	}
}
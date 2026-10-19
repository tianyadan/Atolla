package handler

import (
	"reflect"
	"unsafe"

	"github.com/gin-gonic/gin"
)

// stabilizeRouteTree 把 Gin 路由节点上的 indices 复制到新的堆字符串。
// Gin 1.12 在拆分路由节点时用 unsafe 把 1 字节临时切片当成字符串保存。
// 这块内存不归该字符串所有，进程运行一段时间后会被栈复用覆盖。
// 一旦某个方法树根上的索引字节变了，该方法下的全部路由都会变成 404，其它方法仍正常。
func stabilizeRouteTree(engine *gin.Engine) {
	if engine == nil {
		return
	}
	trees := reflect.ValueOf(engine).Elem().FieldByName("trees")
	if !trees.IsValid() || trees.Kind() != reflect.Slice {
		return
	}
	for i := 0; i < trees.Len(); i++ {
		root := trees.Index(i).FieldByName("root")
		if root.Kind() != reflect.Pointer || root.IsNil() {
			continue
		}
		pinRouteNode(root)
	}
}

// pinRouteNode 递归复制当前节点以及子节点的 indices。
func pinRouteNode(node reflect.Value) {
	elem := node.Elem()
	indices := elem.FieldByName("indices")
	if indices.IsValid() && indices.Kind() == reflect.String && indices.Len() > 0 {
		copied := string([]byte(indices.String()))
		*(*string)(unsafe.Pointer(indices.UnsafeAddr())) = copied
	}
	children := elem.FieldByName("children")
	if !children.IsValid() || children.Kind() != reflect.Slice {
		return
	}
	for i := 0; i < children.Len(); i++ {
		child := children.Index(i)
		if child.Kind() == reflect.Pointer && !child.IsNil() {
			pinRouteNode(child)
		}
	}
}

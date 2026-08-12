import { useState, useCallback, useRef, useEffect, ReactNode } from 'react'

interface ResizableSplitterProps {
  direction: 'horizontal' | 'vertical'
  defaultSize: number
  minSize?: number
  maxSize?: number
  collapsed?: boolean
  children: [ReactNode, ReactNode]
}

export function ResizableSplitter({
  direction,
  defaultSize,
  minSize = 100,
  maxSize,
  collapsed = false,
  children
}: ResizableSplitterProps) {
  const [size, setSize] = useState(defaultSize)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const startPosRef = useRef(0)
  const startSizeRef = useRef(0)
  const sizeRef = useRef(size)
  sizeRef.current = size

  // A caller may intentionally change the preferred split for a different
  // workspace mode (for example, results versus a visual diagram).
  useEffect(() => {
    sizeRef.current = defaultSize
    setSize(defaultSize)
  }, [defaultSize])

  const clampSize = useCallback((containerSize: number) => {
    let s = sizeRef.current
    const effectiveMax = maxSize ?? containerSize - 40
    s = Math.max(minSize, Math.min(effectiveMax, s))
    s = Math.max(40, Math.min(containerSize - 40, s))
    setSize(s)
  }, [minSize, maxSize])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      const containerSize = direction === 'horizontal'
        ? el.getBoundingClientRect().width
        : el.getBoundingClientRect().height
      if (containerSize > 0) clampSize(containerSize)
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [direction, clampSize])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY
    startSizeRef.current = sizeRef.current
  }, [direction])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY
      const delta = currentPos - startPosRef.current
      let newSize = startSizeRef.current + delta

      const containerSize = containerRef.current
        ? (direction === 'horizontal'
          ? containerRef.current.getBoundingClientRect().width
          : containerRef.current.getBoundingClientRect().height)
        : 800

      if (minSize !== undefined) newSize = Math.max(minSize, newSize)
      if (maxSize !== undefined) newSize = Math.min(maxSize, newSize)
      newSize = Math.max(40, Math.min(containerSize - 40, newSize))

      setSize(newSize)
    }

    const handleMouseUp = () => setIsDragging(false)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, direction, minSize, maxSize])

  const isH = direction === 'horizontal'

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isH ? 'row' : 'column',
        height: '100%', width: '100%', overflow: 'hidden'
      }}
    >
      <div style={{
        [isH ? 'width' : 'height']: collapsed ? '0px' : `${size}px`,
        overflow: 'hidden', flexShrink: 0,
        minWidth: 0, minHeight: 0,
        display: collapsed ? 'none' : 'flex',
        flexDirection: 'column'
      }}>
        {children[0]}
      </div>

      {!collapsed && (
        <div
          onMouseDown={handleMouseDown}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            [isH ? 'width' : 'height']: '5px',
            cursor: isH ? 'col-resize' : 'row-resize',
            flexShrink: 0, position: 'relative', zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <div style={{
            [isH ? 'width' : 'height']: '1px',
            [isH ? 'height' : 'width']: '100%',
            background: isDragging ? 'var(--accent-color)'
              : isHovered ? 'var(--text-muted)' : 'var(--border-color)',
            transition: 'background 0.15s ease'
          }} />
        </div>
      )}

      <div style={{
        flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0,
        display: 'flex', flexDirection: 'column'
      }}>
        {children[1]}
      </div>
    </div>
  )
}

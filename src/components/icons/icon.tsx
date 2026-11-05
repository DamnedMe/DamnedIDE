import type { ComponentType, CSSProperties, SVGProps } from 'react'
import { parseSvg, strokeWidthToCss } from './svg'

/** Props of every app icon: size, strokeWidth, color, fill plus any svg attribute. */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref' | 'children' | 'dangerouslySetInnerHTML'> {
  /** width and height in px (default 24) */
  size?: number | string
}

export type AppIcon = ComponentType<IconProps>

type IconStyle = CSSProperties & { '--icon-stroke'?: string }

/**
 * Builds an icon component from an Ionicons outline SVG. The markup keeps its own
 * presentation attributes; global.css (.app-icon) maps the stroke width to --icon-stroke
 * and the global icon zoom. `strokeWidth` uses the 24-grid scale (2 = default), `color`
 * sets the colour (default: the text colour), and a `fill` other than 'none' also fills
 * the outlined shapes. Without aria-label the icon is aria-hidden (decorative).
 */
export function createIcon(name: string, source: string): AppIcon {
  // the root fill is kept: dropping a root fill="none" fills every stroked shape solid
  const { viewBox, body, fill: rootFill = 'currentColor' } = parseSvg(source)
  const markup = { __html: body }

  function Icon({ size = 24, strokeWidth, color, fill, className, style, ...rest }: IconProps) {
    const filled = fill != null && fill !== 'none'
    const stroke = strokeWidthToCss(strokeWidth)
    const css: IconStyle = { ...style }
    if (color) css.color = color
    if (filled) css.fill = fill
    if (stroke) css['--icon-stroke'] = stroke
    const labelled = rest['aria-label'] != null || rest['aria-labelledby'] != null
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        width={size}
        height={size}
        fill={rootFill}
        aria-hidden={labelled ? undefined : true}
        role={labelled ? 'img' : undefined}
        {...rest}
        className={['app-icon', filled ? 'app-icon-filled' : '', className ?? ''].filter(Boolean).join(' ')}
        style={css}
        dangerouslySetInnerHTML={markup}
      />
    )
  }

  Icon.displayName = name
  return Icon
}

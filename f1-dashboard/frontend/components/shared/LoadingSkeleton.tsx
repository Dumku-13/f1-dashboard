/**
 * Skeleton primitives — square (2px) corners, `.shimmer` sweep over a
 * `var(--card)` / `var(--border)` base. Shapes should echo the real content
 * that's loading (a table row, a tile, a line of text), not just be grey boxes.
 */
function ShimmerBlock({ width = '100%', height = '14px', style }: { width?: string; height?: string; style?: React.CSSProperties }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', width, height, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 2, ...style }}>
      <div className="shimmer" style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}

export function SkeletonRow({ cols = 6 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: '8px 12px' }}>
          <ShimmerBlock height="13px" width={i === 0 ? '36px' : '76px'} />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonCard({ height = '120px' }: { height?: string }) {
  return <ShimmerBlock height={height} />
}

export function SkeletonText({ width = '100%', height = '16px' }: { width?: string; height?: string }) {
  return <ShimmerBlock width={width} height={height} />
}

export default function LoadingSkeleton({ rows = 10, cols = 8 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="f1-table">
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonRow key={i} cols={cols} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

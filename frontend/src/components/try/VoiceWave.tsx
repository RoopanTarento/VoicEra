/** Animated voice bars (the brand's `v-bar` keyframes), used by the preloader
 * and the "Creating your agent" mark. Still when the user prefers reduced motion. */
const HEIGHTS = [0.45, 0.75, 1, 0.7, 0.9, 0.55, 0.35];

export function VoiceWave({
  bars = 5,
  height = 36,
  barWidth = 4,
  gap = 4,
  className = "bg-v-accent",
  paused = false,
}: {
  bars?: number;
  height?: number;
  barWidth?: number;
  gap?: number;
  className?: string;
  paused?: boolean;
}) {
  return (
    <span aria-hidden="true" className="flex items-center" style={{ height, gap }}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={`block origin-center rounded-full ${paused ? "" : "animate-v-bar motion-reduce:animate-none"} ${className}`}
          style={{
            width: barWidth,
            height: height * HEIGHTS[i % HEIGHTS.length],
            animationDelay: `${(i % 4) * 0.14 + (i > 3 ? 0.07 : 0)}s`,
          }}
        />
      ))}
    </span>
  );
}

/** Full-page preloader: the voice bars and one quiet line. */
export function VoicePreloader({ label = "Getting your agent builder ready" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-5 py-24 animate-v-rise">
      <span className="relative flex size-20 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-v-pale animate-v-pulse motion-reduce:animate-none" />
        <span className="relative flex size-20 items-center justify-center rounded-full bg-v-pale">
          <VoiceWave bars={5} height={30} barWidth={4} gap={4} />
        </span>
      </span>
      <span className="text-[14px] text-v-muted-2">{label}</span>
    </div>
  );
}

export function NowPlayingBars({
  className,
  paused,
}: {
  className?: string;
  paused?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <rect x="1" y="6" width="3" height="10" rx="1">
        {!paused && (
          <>
            <animate
              attributeName="height"
              values="10;4;8;10"
              dur="0.9s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="y"
              values="6;12;8;6"
              dur="0.9s"
              repeatCount="indefinite"
            />
          </>
        )}
      </rect>
      <rect x="6.5" y="2" width="3" height="14" rx="1">
        {!paused && (
          <>
            <animate
              attributeName="height"
              values="14;6;10;14"
              dur="0.7s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="y"
              values="2;10;6;2"
              dur="0.7s"
              repeatCount="indefinite"
            />
          </>
        )}
      </rect>
      <rect x="12" y="4" width="3" height="12" rx="1">
        {!paused && (
          <>
            <animate
              attributeName="height"
              values="12;8;4;12"
              dur="1.1s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="y"
              values="4;8;12;4"
              dur="1.1s"
              repeatCount="indefinite"
            />
          </>
        )}
      </rect>
    </svg>
  );
}

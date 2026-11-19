import type { ReactNode } from 'react'

function Svg({ children, size = 24, fill = 'none' }: { children: ReactNode; size?: number; fill?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

interface P {
  size?: number
}

export const IconPlay = ({ size }: P) => (
  <Svg size={size} fill="currentColor">
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" stroke="none" />
  </Svg>
)
export const IconPause = ({ size }: P) => (
  <Svg size={size} fill="currentColor">
    <rect x="6" y="4" width="4.5" height="16" rx="1.2" stroke="none" />
    <rect x="13.5" y="4" width="4.5" height="16" rx="1.2" stroke="none" />
  </Svg>
)
export const IconNext = ({ size }: P) => (
  <Svg size={size} fill="currentColor">
    <path d="M5 5.2v13.6a1 1 0 0 0 1.5.86l9.6-6.8a1 1 0 0 0 0-1.72L6.5 4.34A1 1 0 0 0 5 5.2z" stroke="none" />
    <rect x="17" y="4.5" width="3" height="15" rx="1.2" stroke="none" />
  </Svg>
)
export const IconPrev = ({ size }: P) => (
  <Svg size={size} fill="currentColor">
    <path d="M19 5.2v13.6a1 1 0 0 1-1.5.86l-9.6-6.8a1 1 0 0 1 0-1.72l9.6-6.8A1 1 0 0 1 19 5.2z" stroke="none" />
    <rect x="4" y="4.5" width="3" height="15" rx="1.2" stroke="none" />
  </Svg>
)
export const IconShuffle = ({ size }: P) => (
  <Svg size={size}>
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </Svg>
)
export const IconRepeat = ({ size }: P) => (
  <Svg size={size}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </Svg>
)
export const IconRepeatOne = ({ size }: P) => (
  <Svg size={size}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    <path d="M11 10h1v4" />
  </Svg>
)
export const IconHeart = ({ size, filled }: P & { filled?: boolean }) => (
  <Svg size={size} fill={filled ? 'currentColor' : 'none'}>
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
  </Svg>
)
export const IconMore = ({ size }: P) => (
  <Svg size={size} fill="currentColor">
    <circle cx="12" cy="5" r="1.8" stroke="none" />
    <circle cx="12" cy="12" r="1.8" stroke="none" />
    <circle cx="12" cy="19" r="1.8" stroke="none" />
  </Svg>
)
export const IconSearch = ({ size }: P) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
)
export const IconPlus = ({ size }: P) => (
  <Svg size={size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const IconBack = ({ size }: P) => (
  <Svg size={size}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
)
export const IconDown = ({ size }: P) => (
  <Svg size={size}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)
export const IconRefresh = ({ size }: P) => (
  <Svg size={size}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </Svg>
)
export const IconHome = ({ size }: P) => (
  <Svg size={size}>
    <path d="m3 11 9-8 9 8" />
    <path d="M5 10v10h14V10" />
  </Svg>
)
export const IconLibrary = ({ size }: P) => (
  <Svg size={size}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Svg>
)
export const IconList = ({ size }: P) => (
  <Svg size={size}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Svg>
)
export const IconTrash = ({ size }: P) => (
  <Svg size={size}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </Svg>
)
export const IconSettings = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="8" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
)
export const IconStar = ({ size, filled }: P & { filled?: boolean }) => (
  <Svg size={size} fill={filled ? 'currentColor' : 'none'}>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z" />
  </Svg>
)
export const IconVolume = ({ size }: P) => (
  <Svg size={size}>
    <path d="M11 5 6 9H3v6h3l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </Svg>
)
export const IconBook = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" />
    <path d="M4 19a2 2 0 0 1 2-2h13" />
  </Svg>
)
export const IconTap = ({ size }: P) => (
  <Svg size={size}>
    <path d="M22 14a8 8 0 0 1-8 8" />
    <path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
    <path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1" />
    <path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10" />
    <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </Svg>
)
export const IconChevron = ({ size }: P) => (
  <Svg size={size}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
)

export const IconMetronome = ({ size }: P) => (
  <Svg size={size}>
    <path d="M8 21h8l2-1.5L14.2 3.5h-4.4L6 19.5z" />
    <path d="M12 16.5 15.5 7" />
    <path d="M9.5 21v-2.2" />
  </Svg>
)

export const IconSliders = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Svg>
)

export const IconMoon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
  </Svg>
)

export const IconImage = ({ size }: P) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m21 16-5-5-8 8" />
  </Svg>
)

export const IconTag = ({ size }: P) => (
  <Svg size={size}>
    <path d="M3 12V4h8l9 9-8 8z" />
    <circle cx="7.5" cy="8.5" r="1.2" />
  </Svg>
)

export const IconGauge = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="m12 18 4-6" />
  </Svg>
)

export const IconCar = ({ size }: P) => (
  <Svg size={size}>
    <path d="M5 16v-5l2-5h10l2 5v5" />
    <path d="M3 16h18" />
    <circle cx="7.5" cy="18" r="1.5" />
    <circle cx="16.5" cy="18" r="1.5" />
  </Svg>
)

export const IconEyeOff = ({ size }: P) => (
  <Svg size={size}>
    <path d="M3 3l18 18" />
    <path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-3 3.5M6.5 7.5C4 9.2 3 12 3 12s4 6 9 6a9 9 0 0 0 3-.5" />
  </Svg>
)

export const IconTextSize = ({ size }: P) => (
  <Svg size={size}>
    <path d="M3 19 8 6l5 13M5 15h6M15 19l3-7 3 7M16.3 17h3.4" />
  </Svg>
)

export const IconSync = ({ size }: P) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)

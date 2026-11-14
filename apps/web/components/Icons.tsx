// Inline SVG icons (no emoji, FR-17). All are decorative unless given a title.
type P = { className?: string; title?: string };
const S = ({ children, className = "h-5 w-5", title }: P & { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
    {title ? <title>{title}</title> : null}
    {children}
  </svg>
);
export const ThumbUp = (p: P) => <S {...p}><path d="M7 10v11H3V10h4zM7 10l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.1 21H7" /></S>;
export const ThumbDown = (p: P) => <S {...p}><path d="M17 14V3h4v11h-4zM17 14l-4 8a3 3 0 0 1-3-3v-4H4.5a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.9 3H17" /></S>;
export const Person = (p: P) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></S>;
export const Bot = (p: P) => <S {...p}><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 8V4M9 14h.01M15 14h.01" /></S>;
export const Shield = (p: P) => <S {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /></S>;
export const Clock = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>;
export const Pause = (p: P) => <S {...p}><path d="M9 5v14M15 5v14" /></S>;
export const Play = (p: P) => <S {...p}><path d="M7 5l12 7-12 7V5z" /></S>;
export const Send = (p: P) => <S {...p}><path d="M4 12l16-8-6 16-2-7-8-1z" /></S>;
export const Check = (p: P) => <S {...p}><path d="M5 12l5 5 9-10" /></S>;
export const ArrowUp = (p: P) => <S {...p}><path d="M12 19V5M6 11l6-6 6 6" /></S>;
export const Lock = (p: P) => <S {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></S>;
export const Eye = (p: P) => <S {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></S>;
export const Doc = (p: P) => <S {...p}><path d="M6 2h9l5 5v15H6V2z" /><path d="M14 2v6h6" /></S>;
export const Undo = (p: P) => <S {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></S>;

import { useRef, type HTMLAttributes, type PointerEvent, type PropsWithChildren } from 'react';

type SpotlightCardProps = PropsWithChildren<HTMLAttributes<HTMLDivElement> & {
  spotlightColor?: string;
}>;

export function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(10, 132, 255, 0.2)',
  onPointerMove,
  ...props
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mouse-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--mouse-y', `${event.clientY - rect.top}px`);
    card.style.setProperty('--spotlight-color', spotlightColor);
    onPointerMove?.(event);
  };

  return <div {...props} ref={cardRef} className={`card-spotlight ${className}`.trim()} onPointerMove={handlePointerMove}>{children}</div>;
}

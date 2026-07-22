import { forwardRef, type HTMLAttributes, type PropsWithChildren } from 'react';

type BorderGlowProps = PropsWithChildren<HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
  tone?: 'accent' | 'warning' | 'neutral';
}>;

export const BorderGlow = forwardRef<HTMLDivElement, BorderGlowProps>(function BorderGlow({
  children,
  className = '',
  active = false,
  tone = 'accent',
  ...props
}, ref) {
  return <div
    {...props}
    ref={ref}
    className={`border-glow border-glow-${tone}${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
  >
    {children}
  </div>;
});

import { Children, type CSSProperties, type HTMLAttributes, type PropsWithChildren } from 'react';

type AnimatedListProps = PropsWithChildren<Omit<HTMLAttributes<HTMLDivElement>, 'aria-label'> & {
  ariaLabel?: string;
}>;

export function AnimatedList({ children, className = '', ariaLabel, ...props }: AnimatedListProps) {
  return <div
    {...props}
    className={`animated-list${className ? ` ${className}` : ''}`}
    {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
  >
    {Children.map(children, (child, index) => child == null
      ? child
      : <div
        className="animated-list-item"
        style={{ '--animated-list-index': index } as CSSProperties}
      >
        {child}
      </div>)}
  </div>;
}

import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

type PrimaryButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>;

export function PrimaryButton({ children, className = '', ...props }: PrimaryButtonProps) {
  return (
    <button className={`button button--primary ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}

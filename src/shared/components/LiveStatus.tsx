interface LiveStatusProps {
  message: string;
  assertive?: boolean;
}

export function LiveStatus({ message, assertive = false }: LiveStatusProps) {
  return (
    <p
      className="live-status"
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
    >
      {message}
    </p>
  );
}

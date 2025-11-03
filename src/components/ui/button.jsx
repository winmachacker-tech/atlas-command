export function Button({ children, onClick, variant = "default", size = "md", disabled = false, className = "" }) {
  const base =
    "inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none disabled:opacity-50";
  const variants = {
    default: "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900",
    outline: "border border-zinc-300 dark:border-zinc-700 bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800",
    destructive: "bg-red-600 text-white hover:bg-red-700",
  };
  const sizes = {
    sm: "px-2.5 py-1 text-sm",
    md: "px-3.5 py-2 text-sm",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

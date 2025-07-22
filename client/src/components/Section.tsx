export default function Section({ children, className = "" }) {
  return (
    <section className={`w-full flex flex-col items-center justify-center py-20 ${className}`}>
      <div className="w-full max-w-6xl mx-auto px-4">{children}</div>
    </section>
  );
}

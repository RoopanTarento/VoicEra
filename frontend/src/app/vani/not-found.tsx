import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="min-h-dvh grid place-items-center p-6">
      <div style={{ maxWidth: 420 }}>
        <p className="eyebrow mb-3">404</p>
        <h1 className="serif" style={{ fontSize: 34, lineHeight: 1.1, color: "var(--ink)" }}>That page doesn&apos;t exist.</h1>
        <p className="mt-3">The link may be old, or the page may have moved.</p>
        <div className="mt-6 flex gap-2"><Link href="/vani/app" className="va-btn va-btn--primary">Go to your workspace</Link><Link href="/vani" className="va-btn va-btn--secondary">Home</Link></div>
      </div>
    </main>
  );
}

// Shared loading placeholder for the Dashboard — used both as the Suspense
// fallback in AppShell and as DashboardView's own data-loading state, so a cold
// start shows the page's structure instead of a bare spinner.
export default function DashboardSkeleton() {
  return (
    <div className="max-w-lg mx-auto px-3 pt-5 animate-pulse">
      <div className="flex flex-col items-center mb-4">
        <div className="h-8 w-40 bg-dark-700 rounded-lg mb-2" />
        <div className="h-3 w-24 bg-dark-800 rounded" />
      </div>
      <div className="flex justify-center mb-4">
        <div className="h-7 w-40 bg-dark-800 rounded-full" />
      </div>
      <div className="h-32 bg-dark-800/50 rounded-xl mb-4" />
      {[1,2,3,4,5].map(i => (
        <div key={i} className="flex items-center gap-3 py-3 border-b border-dark-800/40">
          <div className="w-9 h-9 rounded-xl bg-dark-700 flex-shrink-0" />
          <div className="flex-1">
            <div className="h-3 w-28 bg-dark-700 rounded mb-1.5" />
            <div className="h-2 w-16 bg-dark-800 rounded" />
          </div>
          <div className="h-3 w-14 bg-dark-700 rounded" />
        </div>
      ))}
    </div>
  );
}

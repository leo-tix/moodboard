export default function ModalLoading() {
  return (
    <div className="fixed inset-0 md:left-56 z-[100] bg-[var(--bg-base)] flex flex-col">
      <div className="flex-shrink-0 h-11 border-b border-[var(--border-subtle)]" />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 bg-[var(--bg-surface)]" />
        <div className="hidden md:block w-80 border-l border-[var(--border-subtle)]" />
      </div>
      <div className="flex-shrink-0 h-[72px] border-t border-[var(--border-subtle)]" />
    </div>
  );
}

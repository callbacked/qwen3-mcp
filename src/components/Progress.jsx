function formatBytes(size) {
  const i = size == 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
  return (
    +(size / Math.pow(1024, i)).toFixed(2) * 1 +
    ["B", "kB", "MB", "GB", "TB"][i]
  );
}

export default function Progress({ text, percentage, total }) {
  percentage ??= 0;
  const displayPercentage = Math.max(0, Math.min(100, percentage)); 

  return (
    <div className="w-full mb-1"> 
      <div className="bg-neutral-200 dark:bg-neutral-700 rounded-full h-2.5 overflow-hidden"> 
        <div
          className="bg-gradient-to-r from-neutral-500 to-neutral-400 h-2.5 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${displayPercentage}%` }}
        >
        </div>
      </div>
      <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 text-center">
        {text}: {displayPercentage.toFixed(1)}%
      </div>
      {!isNaN(total) && total > 0 && (
        <div className="text-xs text-neutral-500 dark:text-neutral-500 mt-0.5 text-center">
          ({formatBytes(total)})
        </div>
      )}
    </div>
  );
}

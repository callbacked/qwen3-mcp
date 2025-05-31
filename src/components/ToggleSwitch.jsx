function ToggleSwitch({ isEnabled, onToggle, size = 'sm', activeColor = 'bg-blue-500', disabled = false }) {
  let width, height, circleSize, translate;
  
  switch (size) {
    case 'xs':
      width = 'w-7';
      height = 'h-4';
      circleSize = 'h-2.5 w-2.5';
      translate = 'translate-x-3';
      break;
    case 'sm':
      width = 'w-9';
      height = 'h-5';
      circleSize = 'h-3.5 w-3.5';
      translate = 'translate-x-4';
      break;
    default: // 'md' or any other value
      width = 'w-11';
      height = 'h-6';
      circleSize = 'h-4 w-4';
      translate = 'translate-x-5';
      break;
  }

  const disabledClass = disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';
  const bgColorClass = isEnabled 
    ? disabled ? 'bg-neutral-600' : activeColor 
    : 'bg-gray-600 dark:bg-neutral-500';

  return (
    <button
      type="button"
      className={`relative inline-flex flex-shrink-0 ${height} ${width} border-2 border-transparent rounded-full transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-neutral-500 dark:focus:ring-offset-neutral-800 ${bgColorClass} ${disabledClass}`}
      role="switch"
      aria-checked={isEnabled}
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
    >
      <span className="sr-only">Use setting</span>
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block ${circleSize} rounded-full bg-white shadow-lg transform ring-0 transition ease-in-out duration-200 ${isEnabled ? translate : 'translate-x-0.5'}`}
      />
    </button>
  );
}

export default ToggleSwitch; 
import type React from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    href: string;
  };
  className?: string;
}

export default function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={`bg-gray-50 rounded-[6px] p-8 text-center ${className ?? ''}`}>
      {icon && (
        <div className="text-gray-400 mx-auto mb-4 w-12 h-12 flex items-center justify-center">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600 mb-4">{description}</p>
      {action && (
        <a
          href={action.href}
          className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 text-white font-semibold rounded-[4px] hover:bg-teal-800 transition-colors"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}

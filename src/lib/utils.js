import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
	return twMerge(clsx(inputs));
}

/**
 * Light background for StatCard icon well. Avoids `text-primary` + naive `bg-primary`
 * (icon and circle would be the same color so the glyph disappears).
 * @param {string} iconTextClass e.g. `text-primary`, `text-green-600`
 */
export function statCardIconWellClass(iconTextClass) {
	if (!iconTextClass) return 'bg-muted/80';
	if (iconTextClass.includes('text-primary')) return 'bg-primary/15';
	return iconTextClass
		.replace('text-', 'bg-')
		.replace(/-600\b/g, '-100')
		.replace(/-500\b/g, '-100')
		.replace(/-700\b/g, '-100');
}
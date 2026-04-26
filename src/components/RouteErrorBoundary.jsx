import React from 'react';
import { Button } from '@/components/ui/button';

/**
 * Catches render errors in route-level trees so a failed page does not white-screen the app.
 */
export class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const err = this.state.error;
      return (
        <div className="mx-auto max-w-lg rounded-lg border border-red-200 bg-red-50/90 p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-red-900">This page could not be displayed</h2>
          <p className="mt-2 break-words text-sm text-red-800/90">
            {err?.message || 'An unexpected error occurred. Try again or use another menu item.'}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" onClick={() => this.setState({ hasError: false, error: null })}>
              Try again
            </Button>
            <Button type="button" onClick={() => window.location.assign('/admin/dashboard')}>
              Go to dashboard
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

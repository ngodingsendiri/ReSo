import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { Button } from './ui/button';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center bg-slate-50/50 rounded-xl border border-slate-200 m-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Terjadi Kesalahan</h2>
          <p className="text-sm text-slate-500 mb-6 max-w-md">
            Sistem mendapati kesalahan saat memuat tampilan ini. Cobalah untuk memuat ulang halaman.
          </p>
          <Button 
            onClick={() => window.location.reload()}
            className="bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold transition-all active:scale-[0.98]"
          >
            <RefreshCcw className="w-4 h-4 mr-2" />
            Muat Ulang
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Edit } from 'lucide-react';
import EngagementDashboard from './components/EngagementDashboard';
import LoginScreen from './components/LoginScreen';
import { useAuth } from './components/FirebaseProvider';
import { ErrorBoundary } from './components/ErrorBoundary';

function LoadingScreen() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return Math.min(prev + Math.floor(Math.random() * 15) + 5, 100);
      });
    }, 150);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="bg-white p-8 rounded-xl  border border-slate-200 flex flex-col items-center w-full max-w-sm"
      >
        <div className="w-20 h-20 bg-slate-900 rounded-xl flex items-center justify-center mb-8 relative overflow-hidden group">
          <div className="absolute inset-0 bg-slate-700/50 animate-ping opacity-20" />
          <Edit className="w-10 h-10 text-white relative z-10 animate-pulse" />
        </div>
        
        <h2 className="text-2xl font-black text-slate-800 tracking-tight mb-2 text-center">Re<span className="text-slate-900">So</span></h2>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center mb-8">Rekap Engagement Sosmed</p>
        
        <div className="w-full space-y-2 relative">
          <div className="flex justify-between items-end mb-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Memproses Data</span>
            <span className="text-xs font-black text-slate-900">{progress}%</span>
          </div>
          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-slate-900 rounded-full"
              initial={{ width: "0%" }}
              animate={{ width: `${progress}%` }}
              transition={{ ease: "easeOut" }}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function App() {
  const { user, loading, error } = useAuth();
  const [showLoading, setShowLoading] = useState(true);

  // Minimum loading time to show the animation
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!loading) {
      // Simulate at least a short loading time for the animation to look good
      timer = setTimeout(() => {
        setShowLoading(false);
      }, 800); 
    }
    return () => clearTimeout(timer);
  }, [loading]);

  if (showLoading || loading) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen text-red-500 font-bold bg-slate-50">
        <div className="bg-white p-6 rounded-xl  border border-red-100 text-center max-w-md">
          <span className="text-3xl mb-4 block">⚠️</span>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <LoginScreen />
      </ErrorBoundary>
    );
  }

  return (
    <div className="min-h-screen">
      <ErrorBoundary>
        <EngagementDashboard />
      </ErrorBoundary>
    </div>
  );
}


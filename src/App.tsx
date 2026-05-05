/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Activity } from 'lucide-react';
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
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="bg-white p-8 rounded-3xl shadow-xl shadow-indigo-100/50 border border-indigo-50 flex flex-col items-center w-full max-w-sm"
      >
        <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 mb-8 relative overflow-hidden group">
          <div className="absolute inset-0 bg-indigo-500/50 animate-ping opacity-20" />
          <Activity className="w-10 h-10 text-white relative z-10 animate-pulse" />
        </div>
        
        <h2 className="text-2xl font-black text-slate-800 tracking-tight mb-2 text-center">RecapLink<span className="text-indigo-600">Smart</span></h2>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center mb-8">Memuat Sistem...</p>
        
        <div className="w-full space-y-2 relative">
          <div className="flex justify-between items-end mb-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Memproses Data</span>
            <span className="text-xs font-black text-indigo-600">{progress}%</span>
          </div>
          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-indigo-600 rounded-full"
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
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100 text-center max-w-md">
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


import React from 'react';
import { motion } from 'motion/react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { itemVariants } from './report-variants';

export interface SortOption {
  value: string;
  label: string;
}

interface ReportControlsProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  currentBadge?: string | null;
  onPrev: () => void;
  onNext: () => void;
  sortOptions: SortOption[];
  activeSort: string;
  onSortChange: (value: string) => void;
  onExportPdf: () => void;
  onExportExcel: () => void;
  onExportImage: () => void;
  canExportImage?: boolean;
  isLoading?: boolean;
}

const EXPORT_LIMIT_NOTE = 'Export gambar dibatasi maks 60 pegawai — gunakan PDF/Excel.';

export function ReportControls({
  title,
  subtitle,
  currentBadge,
  onPrev,
  onNext,
  sortOptions,
  activeSort,
  onSortChange,
  onExportPdf,
  onExportExcel,
  onExportImage,
  canExportImage = true,
  isLoading = false,
}: ReportControlsProps) {
  return (
    <motion.div
      variants={itemVariants}
      className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-4 md:p-5 rounded-xl border border-slate-200 shadow-sm"
    >
      <div className="flex flex-col xl:flex-row items-start xl:items-center gap-4 w-full lg:w-auto lg:ml-auto">
        {/* Navigasi tanggal */}
        <div className="flex items-center gap-2 md:gap-4 bg-slate-50 p-1.5 rounded-xl border border-slate-200 w-full xl:w-auto justify-between">
          <Button
            variant="ghost"
            size="icon"
            onClick={onPrev}
            aria-label="Sebelumnya"
            className="rounded-lg text-slate-600 hover:bg-white shrink-0"
          >
            <ChevronLeft size={16} />
          </Button>
          <div className="text-center px-2 md:px-4 min-w-[160px] md:min-w-[200px]">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
              <h2 className="text-xs sm:text-sm font-bold text-slate-900">{title}</h2>
              {currentBadge && (
                <Badge
                  variant="outline"
                  className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0 font-semibold"
                >
                  {currentBadge}
                </Badge>
              )}
            </div>
            {subtitle && (
              <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onNext}
            aria-label="Berikutnya"
            className="rounded-lg text-slate-600 hover:bg-white shrink-0"
          >
            <ChevronRight size={16} />
          </Button>
        </div>

        {/* Sortir + export */}
        <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
          <div className="flex bg-slate-100 p-1.5 rounded-xl w-full sm:w-auto justify-center sm:justify-start">
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSortChange(opt.value)}
                className={cn(
                  'flex-1 sm:flex-none px-3 py-2 text-xs font-semibold rounded-lg transition-colors',
                  activeSort === opt.value
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 w-full sm:w-auto">
            <Button
              onClick={onExportPdf}
              disabled={isLoading}
              className="gap-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs"
            >
              <FileText size={14} />
              PDF
            </Button>
            <Button
              onClick={onExportExcel}
              disabled={isLoading}
              variant="outline"
              className="gap-2 border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-xs"
            >
              <FileSpreadsheet size={14} className="text-emerald-600" />
              Excel
            </Button>
            <Button
              onClick={onExportImage}
              disabled={isLoading || !canExportImage}
              variant="outline"
              className="gap-2 border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-xs"
            >
              <ImageIcon size={14} />
              Gambar
            </Button>
          </div>
          {!canExportImage && (
            <p className="w-full text-[9px] text-slate-400 font-medium text-center sm:text-left">
              {EXPORT_LIMIT_NOTE}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
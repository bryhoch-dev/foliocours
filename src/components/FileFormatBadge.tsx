import React from 'react';
import {FileCode2, FileText, FileType2} from 'lucide-react';
import type {CourseFileFormat} from '../types/course';
import {getCourseFileFormat} from '../services/fileFormats';

interface FormatStyle {
  label: string;
  badgeClass: string;
  iconClass: string;
  Icon: React.ComponentType<{className?: string}>;
}

const FORMAT_STYLES: Record<CourseFileFormat, FormatStyle> = {
  pdf: {
    label: 'PDF',
    badgeClass: 'border-rose-500/35 bg-rose-500/15 text-rose-300',
    iconClass: 'text-rose-400',
    Icon: FileText,
  },
  docx: {
    label: 'DOCX',
    badgeClass: 'border-sky-500/35 bg-sky-500/15 text-sky-300',
    iconClass: 'text-sky-400',
    Icon: FileType2,
  },
  odt: {
    label: 'ODT',
    badgeClass: 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300',
    iconClass: 'text-emerald-400',
    Icon: FileCode2,
  },
};

export const FileFormatIcon: React.FC<{
  fileName: string;
  format?: CourseFileFormat;
  className?: string;
}> = ({fileName, format, className = 'w-4 h-4 shrink-0'}) => {
  const resolved = format ?? getCourseFileFormat(fileName) ?? 'pdf';
  const {Icon, iconClass} = FORMAT_STYLES[resolved];
  return <Icon className={`${className} ${iconClass}`} />;
};

export const FileFormatBadge: React.FC<{
  fileName: string;
  format?: CourseFileFormat;
}> = ({fileName, format}) => {
  const resolved = format ?? getCourseFileFormat(fileName) ?? 'pdf';
  const {label, badgeClass} = FORMAT_STYLES[resolved];
  return (
    <span
      className={`inline-flex items-center rounded border px-1 py-0.2 font-mono text-[10px] font-semibold tracking-wider uppercase shrink-0 leading-tight ${badgeClass}`}
    >
      {label}
    </span>
  );
};

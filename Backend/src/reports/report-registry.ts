import { REPORT_DEFINITIONS as BASE } from './report-definitions';
import { MORE_REPORTS } from './report-definitions-more';
import { ReportDefinition } from './report-types';

export const REPORT_DEFINITIONS: ReportDefinition[] = [...BASE, ...MORE_REPORTS];

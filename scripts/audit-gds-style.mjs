#!/usr/bin/env node
/**
 * GDS Style Audit Script
 * Checks for forbidden Tailwind classes and hardcoded colors
 * Enforces semantic tone usage across the codebase
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Forbidden patterns - hardcoded colors via Tailwind
const FORBIDDEN_PATTERNS = [
  {
    pattern: /className=["'][^"']*\b(text|bg|border)-(red|blue|green|yellow|orange|purple|pink|gray|slate|zinc|neutral|stone|amber|lime|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose)-\d+\b[^"']*["']/g,
    name: 'Hardcoded color classes',
    fix: 'Use semantic tone props (e.g., tone="strategy") instead of bg-blue-500 or text-red-600',
    severity: 'error',
  },
  {
    pattern: /className=["'][^"']*rounded-(sm|md|lg|xl|2xl|full)\b[^"']*["']/g,
    name: 'Hardcoded border radius',
    fix: 'Use default radius or explicit radius prop',
    severity: 'warn',
  },
  {
    pattern: /className=["'][^"']*(shadow-(sm|md|lg|xl|2xl)|shadow-inner|shadow-none)\b[^"']*["']/g,
    name: 'Hardcoded shadow',
    fix: 'Use Mantine shadow prop or withBorder instead',
    severity: 'warn',
  },
  {
    pattern: /style=\{\s*\{\s*[^}]*:\s*['"]#[0-9a-fA-F]{3,8}['"]/g,
    name: 'Inline hex color',
    fix: 'Use CSS variables (var(--mantine-color-*)) or semantic tone props',
    severity: 'error',
  },
  {
    pattern: /(?:color|backgroundColor|borderColor|fill|stroke)=\s*['"](?:rgb|rgba|hsl|hsla)\([^)]+\)['"]/g,
    name: 'Inline RGB/HSL color',
    fix: 'Use Mantine color system (e.g., color="blue.6") or CSS variables',
    severity: 'error',
  },
];

// Files to check
const TARGET_DIRS = ['app', 'components'];
const FILE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
const EXCLUDE_PATTERNS = ['node_modules', '.next', 'public', 'scripts'];

let errorCount = 0;
let warningCount = 0;

function shouldExclude(path) {
  return EXCLUDE_PATTERNS.some(pattern => path.includes(pattern));
}

function getFilesToCheck() {
  const files = [];
  
  TARGET_DIRS.forEach(dir => {
    const fullPath = resolve(process.cwd(), dir);
    if (!existsSync(fullPath)) return;
    
    try {
      const output = execSync(`find ${fullPath} -type f \\( -name "*.tsx" -o -name "*.ts" -o -name "*.jsx" -o -name "*.js" \\)`);
      const fileList = output.toString().trim().split('\n');
      files.push(...fileList);
    } catch (error) {
      // Directory might not exist
    }
  });
  
  return files.filter(file => !shouldExclude(file));
}

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const issues = [];
  
  lines.forEach((line, index) => {
    FORBIDDEN_PATTERNS.forEach(({ pattern, name, fix, severity }) => {
      pattern.lastIndex = 0; // Reset regex
      if (pattern.test(line)) {
        issues.push({
          line: index + 1,
          name,
          fix,
          severity,
          snippet: line.trim(),
        });
        
        if (severity === 'error') {
          errorCount++;
        } else if (severity === 'warn') {
          warningCount++;
        }
      }
    });
  });
  
  return issues;
}

function printHeader() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║         GDS Style Audit - CogMap                         ║');
  console.log('║    Enforcing General Design System Compliance             ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
}

function printResults(filesChecked, allIssues) {
  if (allIssues.length === 0) {
    console.log('✅ ✅ ✅  No GDS violations found!  ✅ ✅ ✅\n');
    console.log(`Files checked: ${filesChecked}`);
    console.log('Your code is fully compliant with the GDS design system.\n');
    return;
  }
  
  console.log('❌ GDS Style Violations Found:\n');
  console.log(`Files checked: ${filesChecked}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Warnings: ${warningCount}\n`);
  
  // Group by file
  const byFile = {};
  allIssues.forEach(({ file, issues }) => {
    if (issues.length > 0) {
      byFile[file] = issues;
    }
  });
  
  Object.entries(byFile).forEach(([file, issues]) => {
    console.log(`\n📄 ${file}`);
    console.log('─'.repeat(70));
    
    issues.forEach(issue => {
      const icon = issue.severity === 'error' ? '❌' : '⚠️';
      const severityLabel = issue.severity.toUpperCase();
      console.log(`\n  ${icon} [${severityLabel}] Line ${issue.line}: ${issue.name}`);
      console.log(`     ${issue.snippet.substring(0, 100)}${issue.snippet.length > 100 ? '...' : ''}`);
      console.log(`     💡 ${issue.fix}`);
    });
  });
  
  console.log('\n' + '═'.repeat(70));
  console.log('\n📊 Summary:');
  console.log(`   Errors: ${errorCount}`);
  console.log(`   Warnings: ${warningCount}`);
  console.log(`   Total issues: ${errorCount + warningCount}\n`);
  
  if (errorCount > 0) {
    console.log('❌ Audit FAILED - Fix errors before deploying\n');
    process.exit(1);
  } else {
    console.log('⚠️  Audit PASSED with warnings\n');
  }
}

function main() {
  printHeader();
  
  console.log('🔍 Checking for forbidden patterns...\n');
  
  const files = getFilesToCheck();
  const allIssues = [];
  
  files.forEach(file => {
    const issues = checkFile(file);
    if (issues.length > 0) {
      allIssues.push({ file, issues });
    }
  });
  
  printResults(files.length, allIssues);
  
  if (allIssues.length > 0) {
    console.log('📚 Need help? Check the GDS documentation:');
    console.log('   https://sovereignsquad.github.io/general-design-system/\n');
  }
}

main();

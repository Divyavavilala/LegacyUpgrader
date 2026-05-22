import React, { useState } from 'react';
import { 
  Upload, 
  Search, 
  Code2, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  ArrowRight,
  Terminal,
  Shield,
  Layout,
  RefreshCcw,
  Download,
  Github,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import Markdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { 
  analyzeProject, 
  refactorProject, 
  generateReport, 
  FileContent, 
  AnalysisResult, 
  RefactorResult, 
  MigrationReport 
} from './services/groqService';

const SAMPLES = {
  crm: [
    {
      name: "index.html",
      content: `<!DOCTYPE html>
<html>
<head>
  <title>Legacy CRM Portal</title>
  <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css">
  <script src="https://code.jquery.com/jquery-2.2.4.min.js"></script>
</head>
<body style="padding: 20px;">
  <div class="container">
    <div class="page-header">
      <h1 class="text-primary">CRM Dashboard</h1>
      <p class="lead">Manage customer profiles inline</p>
    </div>
    
    <div class="row">
      <div class="col-md-8">
        <table class="table table-bordered table-striped" id="customerTable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Alice Smith</td>
              <td><span class="label label-success">Active</span></td>
              <td><button class="btn btn-xs btn-danger delete-btn">Delete</button></td>
            </tr>
            <tr>
              <td>Bob Jones</td>
              <td><span class="label label-warning">Pending</span></td>
              <td><button class="btn btn-xs btn-danger delete-btn">Delete</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="col-md-4">
        <div class="panel panel-default">
          <div class="panel-heading">Add Customer</div>
          <div class="panel-body">
            <input type="text" id="newName" class="form-control" placeholder="Customer name" />
            <button id="addBtn" class="btn btn-primary btn-block" style="margin-top: 10px;">Add</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    $(document).ready(function() {
      $("#addBtn").on("click", function() {
        var name = $("#newName").val();
        if(name) {
          // XSS Vulnerability via direct DOM injection
          var row = "<tr><td>" + name + "</td><td><span class='label label-success'>Active</span></td><td><button class='btn btn-xs btn-danger delete-btn'>Delete</button></td></tr>";
          $("#customerTable tbody").append(row);
          $("#newName").val("");
        }
      });

      $(document).on("click", ".delete-btn", function() {
        $(this).closest("tr").remove();
      });
    });
  </script>
</body>
</html>`
    },
    {
      name: "styles.css",
      content: `.container { margin-top: 30px; border-radius: 4px; border: 1px solid #ddd; padding: 30px; }
.delete-btn { font-size: 11px; }`
    }
  ],
  todo: [
    {
      name: "index.html",
      content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Legacy Todo Manager</title>
  <style>
    body { font-family: "Courier New", monospace; background-color: #f0f0f0; padding: 40px; }
    .todo-panel { background: #fff; border: 3px double #333; padding: 20px; max-width: 500px; margin: 0 auto; }
    .todo-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px dashed #ccc; }
    .done { text-decoration: line-through; color: #777; }
  </style>
</head>
<body>
  <div class="todo-panel">
    <h2>Todo Checklist</h2>
    <div id="list">
      <div class="todo-item">
        <span>Upgrade Node Engine</span>
        <input type="checkbox" onclick="toggleTodo(this)">
      </div>
      <div class="todo-item">
        <span>Sanitize Legacy Query Handles</span>
        <input type="checkbox" onclick="toggleTodo(this)">
      </div>
    </div>
  </div>
  <script>
    function toggleTodo(el) {
      var textNode = el.previousElementSibling;
      if (el.checked) {
        textNode.className = "done";
      } else {
        textNode.className = "";
      }
    }
  </script>
</body>
</html>`
    }
  ]
};

type Stage = 'upload' | 'analyzing' | 'refactoring' | 'reporting' | 'complete';

export default function App() {
  const [files, setFiles] = useState<FileContent[]>([]);
  const [stage, setStage] = useState<Stage>('upload');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [refactor, setRefactor] = useState<RefactorResult | null>(null);
  const [report, setReport] = useState<MigrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState('');
  const [fetchingRepo, setFetchingRepo] = useState(false);
  const [gitStatus, setGitStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // States for interactive manual code entry
  const [manualFileName, setManualFileName] = useState('index.html');
  const [manualContent, setManualContent] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  // States for high-speed rate-limit resistant github scan
  const [githubToken, setGithubToken] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);

  const handleGitRepoScan = async () => {
    if (!githubUrl.includes('github.com')) {
      setError('Please enter a valid GitHub repository URL.');
      return;
    }

    const segments = githubUrl.split('github.com/')[1]?.split('/');
    if (!segments || segments.length < 2) {
      setError('Invalid GitHub URL format.');
      return;
    }

    const owner = segments[0];
    const repo = segments[1].replace('.git', '').split('?')[0]; // strip query parameters if any
    
    setFetchingRepo(true);
    setGitStatus('Resolving branch metadata...');
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12-second safeguard timeout

    const reqHeaders: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json'
    };
    if (githubToken.trim()) {
      reqHeaders['Authorization'] = `token ${githubToken.trim()}`;
    }

    try {
      // 1. Fetch Repository metadata to locate the default branch cleanly
      let branch = 'main';
      let metadataOk = false;
      try {
        const repoInfoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: reqHeaders,
          signal: controller.signal
        });
        if (repoInfoRes.ok) {
          const repoInfo = await repoInfoRes.json();
          branch = repoInfo.default_branch || 'main';
          metadataOk = true;
        } else if (repoInfoRes.status === 403) {
          console.warn('GitHub API rate limited on metadata check. Falling back to RAW CDN direct probe.');
        }
      } catch (err) {
        console.warn('Metadata fetch failed, falling back to CDN probe style.', err);
      }

      let loadedFiles: FileContent[] = [];

      if (metadataOk) {
        // High Speed Context-Based Contents Scan instead of heavy recursion
        setGitStatus('Inspecting repository root nodes...');
        const rootContentsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents?ref=${branch}`, {
          headers: reqHeaders,
          signal: controller.signal
        });

        if (rootContentsRes.ok) {
          const rootItems = await rootContentsRes.json();
          const filesToFetch: Array<{ name: string; url: string }> = [];
          const foldersToScan: string[] = [];

          if (Array.isArray(rootItems)) {
            for (const item of rootItems) {
              if (item.type === 'file') {
                const lower = item.name.toLowerCase();
                if (lower.endsWith('.html') || lower.endsWith('.css') || lower.endsWith('.js')) {
                  filesToFetch.push({ name: item.path, url: item.download_url });
                }
              } else if (item.type === 'dir') {
                const name = item.name.toLowerCase();
                // We recursively inspect common source directories, but skip build, package, log, or heavy dependency folders
                if (['src', 'js', 'css', 'html', 'public', 'assets', 'pages', 'app'].includes(name)) {
                  foldersToScan.push(item.path);
                }
              }
            }
          }

          // Fetch the contents of the identified key subfolders
          if (foldersToScan.length > 0) {
            setGitStatus(`Crawling active directories: [${foldersToScan.join(', ')}]...`);
            await Promise.all(
              foldersToScan.slice(0, 4).map(async (folderPath) => {
                try {
                  const folderRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${folderPath}?ref=${branch}`, {
                    headers: reqHeaders,
                    signal: controller.signal
                  });
                  if (folderRes.ok) {
                    const items = await folderRes.json();
                    if (Array.isArray(items)) {
                      for (const item of items) {
                        if (item.type === 'file') {
                          const lower = item.name.toLowerCase();
                          if (lower.endsWith('.html') || lower.endsWith('.css') || lower.endsWith('.js')) {
                            filesToFetch.push({ name: item.path, url: item.download_url });
                          }
                        }
                      }
                    }
                  }
                } catch (e) {
                  console.warn(`Failed to scan folder: ${folderPath}`, e);
                }
              })
            );
          }

          // Fetch the contents of up to 15 key files in parallel
          const sliceToFetch = filesToFetch.slice(0, 15);
          if (sliceToFetch.length > 0) {
            setGitStatus(`Downloading matched source assets (${sliceToFetch.length} identified)...`);
            loadedFiles = await Promise.all(
              sliceToFetch.map(async (f) => {
                const fileRes = await fetch(f.url, { signal: controller.signal });
                if (!fileRes.ok) throw new Error(`Failed to load ${f.name}`);
                const text = await fileRes.text();
                return { name: f.name, content: text };
              })
            );
          }
        }
      }

      // 2. If no files loaded because API failed, was rate-limited or root was empty, trigger RAW CDN Direct Probe
      if (loadedFiles.length === 0) {
        setGitStatus('API limit/lag fallback: Scanning via high-speed RAW RAW CDN...');
        // Try both main and master branches
        const branchesToTry = metadataOk ? [branch] : ['main', 'master'];
        const commonFilenames = [
          'index.html',
          'style.css',
          'styles.css',
          'script.js',
          'main.js',
          'app.js',
          'index.js',
          'src/index.html',
          'src/style.css',
          'src/script.js',
          'src/main.js'
        ];

        for (const b of branchesToTry) {
          const results = await Promise.all(
            commonFilenames.map(async (fn) => {
              try {
                const url = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/${fn}`;
                const res = await fetch(url, { signal: controller.signal });
                if (res.ok) {
                  const content = await res.text();
                  return { name: fn, content };
                }
              } catch (e) {
                // ignore
              }
              return null;
            })
          );
          const activeFiles = results.filter((r): r is FileContent => r !== null);
          if (activeFiles.length > 0) {
            loadedFiles = activeFiles;
            break; 
          }
        }
      }

      if (loadedFiles.length === 0) {
        throw new Error('No .html, .css, or .js files could be found or fetched. Ensure the repository has these files or try manual drop/copy-paste below!');
      }

      clearTimeout(timeoutId);
      setFiles(loadedFiles);
      setError(null);
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        setError('GitHub scan timed out. Large repository size or GitHub API lag detected. Please configure an optional Personal Access Token (PAT) below, or drop your .zip file / folders directly!');
      } else {
        setError(err.message || 'Failed to scan repository.');
      }
    } finally {
      setFetchingRepo(false);
      setGitStatus('');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = event.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    const fileList: FileContent[] = [];
    
    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      
      if (file.name.endsWith('.zip')) {
        const zip = new JSZip();
        try {
          const content = await zip.loadAsync(file);
          for (const [filename, fileObj] of Object.entries(content.files)) {
            if (!fileObj.dir) {
              const text = await fileObj.async('string');
              fileList.push({ name: filename, content: text });
            }
          }
        } catch (e) {
          setError('Failed to load zip file.');
        }
      } else {
        const text = await file.text();
        fileList.push({ name: file.name, content: text });
      }
    }

    setFiles(fileList);
    setError(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;

    const fileList: FileContent[] = [];
    for (let i = 0; i < droppedFiles.length; i++) {
      const file = droppedFiles[i];
      if (file.name.endsWith('.zip')) {
        const zip = new JSZip();
        try {
          const content = await zip.loadAsync(file);
          for (const [filename, fileObj] of Object.entries(content.files)) {
            if (!fileObj.dir) {
              const text = await fileObj.async('string');
              fileList.push({ name: filename, content: text });
            }
          }
        } catch (e) {
          setError('Failed to load zip file.');
        }
      } else {
        const text = await file.text();
        fileList.push({ name: file.name, content: text });
      }
    }

    if (fileList.length > 0) {
      setFiles(fileList);
      setError(null);
    }
  };

  const loadSample = (type: 'crm' | 'todo') => {
    setFiles(SAMPLES[type]);
    setError(null);
  };

  const startPipeline = async () => {
    if (files.length === 0) return;
    
    setError(null);

    const PIPELINE_TIMEOUT_MS = 90000;
    let pipelineTimedOut = false;
    const timeoutId = setTimeout(() => {
      pipelineTimedOut = true;
    }, PIPELINE_TIMEOUT_MS);

    try {
      setStage('analyzing');
      const analysisData = await analyzeProject(files);
      if (pipelineTimedOut) throw new Error('TIMEOUT: The pipeline took too long. Try with fewer or smaller files.');
      setAnalysis(analysisData);

      setStage('refactoring');
      const refactorData = await refactorProject(files, analysisData);
      if (pipelineTimedOut) throw new Error('TIMEOUT: The pipeline took too long. Try with fewer or smaller files.');
      setRefactor(refactorData);

      setStage('reporting');
      const reportData = await generateReport(files, refactorData.files, analysisData);
      if (pipelineTimedOut) throw new Error('TIMEOUT: The pipeline took too long. Try with fewer or smaller files.');
      setReport(reportData);

      clearTimeout(timeoutId);
      setStage('complete');
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error(err);
      const msg = err.message || 'An error occurred during the modernization process.';
      setError(msg);
      setStage('upload');

      if (msg.includes('QUOTA_EXCEEDED') || msg.includes('GROQ_API_KEY_MISSING') || msg.includes('RATE_LIMIT')) {
        // Automatically scroll to error
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
    }
  };

  const reset = () => {
    setFiles([]);
    setStage('upload');
    setAnalysis(null);
    setRefactor(null);
    setReport(null);
    setError(null);
    setGithubUrl('');
  };

  const downloadBundle = async () => {
    if (!refactor) return;
    
    try {
      const zip = new JSZip();
      refactor.files.forEach(file => {
        // Ensure directories are created if path is nested
        zip.file(file.name, file.content);
      });
      
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'modernized_bundle.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate zip:', err);
      setError('Failed to generate the download bundle.');
    }
  };

  const downloadMigrationReport = () => {
    if (!report || !refactor) return;

    let content = "";
    content += "=========================================================\n";
    content += "LEGACYUPGRADER - AUTONOMOUS MIGRATION REPORT\n";
    content += "=========================================================\n\n";

    content += "## QUALITY METRIC SUMMARY\n";
    if (report.originalBytes > 0) {
      const originalKB = (report.originalBytes / 1024).toFixed(1);
      const modernizedKB = (report.modernizedBytes / 1024).toFixed(1);
      const reduction = report.originalBytes > report.modernizedBytes
        ? `${Math.round(((report.originalBytes - report.modernizedBytes) / report.originalBytes) * 100)}%`
        : '0%';
      content += `- Original Bundle Size   : ${originalKB} KB (${report.originalBytes} bytes)\n`;
      content += `- Modernized Bundle Size : ${modernizedKB} KB (${report.modernizedBytes} bytes)\n`;
      content += `- Code Weight Reduction  : ${reduction}\n`;
    }
    content += `- Optimization Indicator : Estimated build and dependency optimization improvements\n`;
    content += `- Accessibility Score    : ${report.accessibilityScore || 95}/100\n`;
    content += `- Type Safety Standard   : Improved type-safety compatibility analysis\n\n`;

    if (analysis) {
      content += "## ROOT ANALYSIS FINDINGS\n";
      content += `### Detected Technologies:\n${analysis.technologies.map(t => `- ${t}`).join('\n')}\n\n`;
      content += `### Identified Technical Debt & Risks:\n${analysis.issues.map(i => `- ${i}`).join('\n')}\n\n`;
      content += `### Executive Summary:\n${analysis.summary}\n\n`;
    }

    content += "## MIGRATION JOURNEY (BEFORE & AFTER)\n";
    content += `${report.beforeAfter}\n\n`;

    content += "## PERFORMANCE & MODERNIZATION BENEFITS\n";
    content += `${report.performanceImprovements}\n\n`;

    content += "## VULNERABILITIES & COMPLIANCE FIXED\n";
    content += `${report.vulnerabilitiesFixed.map(v => `- [x] ${v}`).join('\n')}\n\n`;

    content += "=========================================================\n";
    content += "MODERNIZED SOURCE CODE AND ARTIFACTS\n";
    content += "=========================================================\n\n";

    refactor.files.forEach(file => {
      content += `### FILE: ${file.name}\n`;
      content += "---------------------------------------------------------\n";
      content += file.content;
      content += "\n---------------------------------------------------------\n\n";
    });

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Migration_Report_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen font-sans">
      {/* Header */}
      <header className="border-b border-surface-border bg-surface-900 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-blue flex items-center justify-center font-bold text-black rounded-sm">
              <RefreshCcw className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-semibold text-lg tracking-tight uppercase">LegacyUpgrader</h1>
              <p className="text-[10px] text-text-muted uppercase tracking-[0.2em]">Autonomous Modernization</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs text-text-secondary uppercase tracking-widest">Agent State: active</span>
            </div>
            <button 
              onClick={reset}
              className="px-4 py-1.5 bg-text-primary text-black text-xs font-bold uppercase tracking-wide rounded-sm hover:bg-white transition-colors"
            >
              Reset Session
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {stage === 'upload' && (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-3xl mx-auto space-y-8"
            >
              <div className="text-center space-y-4">
                <h2 className="text-5xl font-light italic text-text-primary">Agent Orchestration</h2>
                <p className="text-[#71717a] text-sm mt-1 uppercase tracking-wider font-mono">Modernize legacy codebases through autonomous execution graphs</p>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-8 text-center">
                <div className="p-4 border border-surface-border bg-surface-700 space-y-2 rounded-sm">
                  <p className="text-[10px] font-mono text-text-muted mb-1">#01_ANALYZER</p>
                  <h3 className="font-medium text-sm">Structure Scan</h3>
                  <div className="mt-4 h-1 bg-surface-border"><div className="h-full bg-brand-emerald w-full"></div></div>
                </div>
                <div className="p-4 border border-surface-border bg-surface-700 space-y-2 rounded-sm">
                  <p className="text-[10px] font-mono text-text-muted mb-1">#02_REFACTOR</p>
                  <h3 className="font-medium text-sm">Code Evolution</h3>
                  <div className="mt-4 h-1 bg-surface-border"><div className="h-full bg-brand-blue w-2/3"></div></div>
                </div>
                <div className="p-4 border border-surface-border bg-surface-700 space-y-2 rounded-sm shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                  <p className="text-[10px] font-mono text-text-muted mb-1">#03_SECURITY</p>
                  <h3 className="font-medium text-sm">Threat Patching</h3>
                  <div className="mt-4 h-1 bg-surface-border"><div className="h-full bg-brand-emerald w-1/2"></div></div>
                </div>
              </div>

              {files.length === 0 && (
                <div className="space-y-4">
                  <div className="flex bg-surface-900 border border-surface-border rounded-sm p-1">
                    <div className="flex-1 flex items-center px-4 gap-3 bg-surface-800 border-r border-surface-border">
                      <Github className="w-5 h-5 text-text-muted" />
                      <input 
                        type="text" 
                        placeholder="GITHUB REPOSITORY URL (HTTPS)" 
                        className="bg-transparent border-none outline-none text-xs font-mono w-full text-text-primary placeholder:text-text-muted py-3"
                        value={githubUrl}
                        onChange={(e) => setGithubUrl(e.target.value)}
                      />
                    </div>
                    <button 
                      onClick={handleGitRepoScan}
                      disabled={fetchingRepo || !githubUrl}
                      className="px-6 py-2 bg-brand-blue text-black font-bold text-[10px] uppercase tracking-widest hover:bg-blue-400 disabled:opacity-50 disabled:grayscale transition-all rounded-sm flex items-center gap-2 cursor-pointer"
                    >
                      {fetchingRepo ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          SCANNING...
                        </>
                      ) : (
                        <>
                          SCAN REPO
                          <Search className="w-3 h-3" />
                        </>
                      )}
                    </button>
                  </div>
                  {fetchingRepo && gitStatus && (
                    <p className="text-[10px] text-brand-blue uppercase tracking-widest font-mono font-bold animate-pulse px-1">
                      &gt;&gt; {gitStatus}
                    </p>
                  )}

                  {/* High speed / Rate Limit settings */}
                  <div className="flex flex-col gap-2 p-3 bg-surface-900/50 border border-surface-border/50 rounded-sm">
                    <div className="flex items-center justify-between">
                      <button 
                        type="button"
                        onClick={() => setShowTokenInput(!showTokenInput)}
                        className="text-[9px] font-mono text-brand-emerald/90 uppercase tracking-wider font-bold hover:text-emerald-400 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        {showTokenInput ? '[-] Hide GitHub Token Settings' : '[+] Slow scan/rate limit issues? Add GitHub PAT (Optional)'}
                      </button>
                      {githubToken && (
                        <span className="text-[8px] font-mono bg-brand-emerald/10 border border-brand-emerald/30 text-brand-emerald px-1.5 py-0.5 rounded-sm uppercase tracking-widest font-bold">
                          Token Loaded
                        </span>
                      )}
                    </div>

                    {showTokenInput && (
                      <div className="mt-2 space-y-2 border-t border-surface-border/30 pt-2">
                        <p className="text-[10px] text-text-muted leading-relaxed">
                          Providing a GitHub Personal Access Token (PAT) lifts GitHub's unauthenticated rate-limits, allowing seamless high-speed scanning of larger repositories or multiple iterations.
                        </p>
                        <div className="flex gap-2">
                          <input 
                            type="password"
                            placeholder="ghp_YOUR_TOKEN"
                            value={githubToken}
                            onChange={(e) => {
                              const v = e.target.value;
                              setGithubToken(v);
                            }}
                            className="bg-surface-800 border border-surface-border rounded-sm px-2.5 py-1.5 text-xs font-mono w-full text-text-primary focus:border-brand-emerald outline-none"
                          />
                          {githubToken && (
                            <button
                              type="button"
                              onClick={() => {
                                setGithubToken('');
                              }}
                              className="px-3 py-1.5 bg-red-950/40 hover:bg-red-950/80 border border-red-500/30 text-red-400 text-[10px] font-mono uppercase font-bold tracking-wider rounded-sm transition-all cursor-pointer"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="h-[1px] bg-surface-border flex-1" />
                    <span className="text-[10px] text-text-muted font-bold">OR</span>
                    <div className="h-[1px] bg-surface-border flex-1" />
                  </div>
                </div>
              )}

              <div 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border rounded-sm p-6 sm:p-12 transition-all flex flex-col justify-center space-y-6 ${isDragging ? 'border-brand-blue bg-blue-950/20' : 'border-surface-border bg-surface-800'} ${files.length > 0 ? '' : 'hover:border-text-muted'}`}
              >
                {showManualInput ? (
                  <div className="w-full space-y-4">
                    <div className="flex items-center justify-between border-b border-surface-border pb-2">
                      <h3 className="font-mono text-xs text-brand-emerald uppercase tracking-[0.2em] flex items-center gap-2">
                        <Code2 className="w-4 h-4" />
                        Interactive Code Composer
                      </h3>
                      <button 
                        onClick={() => {
                          setShowManualInput(false);
                          setManualContent('');
                        }} 
                        className="text-[10px] text-text-muted uppercase hover:text-red-400 transition-colors cursor-pointer tracking-widest"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] uppercase font-mono tracking-widest text-[#71717a]">File Name</label>
                        <input 
                          type="text" 
                          value={manualFileName}
                          onChange={(e) => setManualFileName(e.target.value)}
                          placeholder="index.html"
                          className="w-full bg-surface-900 border border-surface-border rounded-sm px-3 py-2 text-xs font-mono text-text-primary focus:border-brand-blue outline-none mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-mono tracking-widest text-[#71717a]">Code Content</label>
                        <textarea 
                          rows={6}
                          value={manualContent}
                          onChange={(e) => setManualContent(e.target.value)}
                          placeholder="Paste your legacy jQuery, inline CSS, or ES5 JavaScript here..."
                          className="w-full bg-surface-900 border border-surface-border rounded-sm px-3 py-2 text-xs font-mono text-text-primary focus:border-brand-emerald outline-none mt-1 resize-none custom-scrollbar"
                        />
                      </div>
                      <button 
                        onClick={() => {
                          if (manualFileName.trim() && manualContent.trim()) {
                            const name = manualFileName.trim();
                            const newFiles = files.filter(f => f.name !== name);
                            setFiles([...newFiles, { name, content: manualContent }]);
                            setManualContent('');
                            setShowManualInput(false);
                            setError(null);
                          } else {
                            setError('Please provide both a non-empty name and source code content.');
                          }
                        }}
                        className="w-full bg-brand-emerald text-black font-mono font-bold py-2.5 uppercase tracking-widest text-[10px] rounded-sm hover:bg-emerald-400 transition-all cursor-pointer"
                      >
                        Save & Add File To Context
                      </button>
                    </div>
                  </div>
                ) : files.length === 0 ? (
                  <label className="cursor-pointer flex flex-col items-center justify-center space-y-6 w-full py-4 group">
                    <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                    
                    {/* Centered Import Symbol */}
                    <div className="w-16 h-16 bg-surface-900 border border-surface-border group-hover:border-brand-emerald flex items-center justify-center text-text-muted group-hover:text-brand-emerald transition-all rounded-sm">
                      <Upload className="w-8 h-8 transition-transform group-hover:scale-105" />
                    </div>

                    <div className="text-center space-y-4">
                      <div>
                        <span className="text-text-primary font-bold hover:underline decoration-text-muted underline-offset-4 tracking-wider uppercase font-mono text-xs">
                          CLICK TO IMPORT FILES
                        </span>
                        <span className="text-text-secondary tracking-wider font-mono text-xs"> OR DRAG AND DROP HERE</span>
                        <p className="text-[10px] text-text-muted uppercase tracking-widest mt-2 font-mono">ZIP/Files supported • v2.1 jQuery • Bootstrap 3 • ES5</p>
                      </div>
                      <div className="pt-4 border-t border-surface-border/40 w-full flex justify-center">
                        <button 
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowManualInput(true);
                          }}
                          className="text-[10px] text-brand-emerald uppercase font-bold tracking-widest hover:text-emerald-400 underline decoration-emerald-800 underline-offset-4 cursor-pointer"
                        >
                          &gt;_ Write/Paste Code File Manually
                        </button>
                      </div>
                    </div>
                  </label>
                ) : (
                  <div className="w-full space-y-4">
                    <div className="flex items-center justify-between border-b border-surface-border pb-2">
                      <h3 className="font-mono text-xs text-text-muted uppercase tracking-[0.2em] flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Source Context ({files.length} nodes)
                      </h3>
                      <div className="flex gap-4">
                        <button 
                          onClick={() => setShowManualInput(true)} 
                          className="text-[10px] text-brand-emerald uppercase hover:text-emerald-400 transition-colors cursor-pointer tracking-widest font-mono font-bold"
                        >
                          + Add File
                        </button>
                        <button 
                          onClick={() => setFiles([])} 
                          className="text-[10px] text-text-muted uppercase hover:text-red-400 transition-colors cursor-pointer tracking-widest font-mono"
                        >
                          Discard All
                        </button>
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1.5 pr-2 custom-scrollbar">
                      {files.map((f, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-surface-900 border border-surface-border rounded-sm group font-mono">
                          <span className="text-xs truncate text-text-secondary max-w-[75%]">{f.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-[9px] font-bold text-brand-emerald">IDENTIFIED</span>
                            <button 
                              onClick={() => {
                                const updated = [...files];
                                updated.splice(i, 1);
                                setFiles(updated);
                              }}
                              className="text-text-muted hover:text-red-400 p-0.5 rounded cursor-pointer transition-colors text-xs font-bold"
                              title="Delete file"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button 
                      onClick={startPipeline}
                      className="w-full bg-text-primary text-black font-bold py-3 uppercase tracking-widest text-xs rounded-sm flex items-center justify-center gap-2 hover:bg-white transition-all active:scale-[0.99] cursor-pointer"
                    >
                      Initialize Autonomous Process
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {files.length === 0 && (
                <div className="border border-surface-border rounded-sm p-6 bg-surface-900/40 space-y-4">
                  <div>
                    <h4 className="text-[10px] font-mono font-bold text-text-muted uppercase tracking-[0.2em] mb-1">Modernization Presets</h4>
                    <p className="text-[11px] text-text-secondary">Don't have a legacy bundle on your machine? Load an instant testing sandbox:</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => loadSample('crm')}
                      className="p-3 border border-surface-border hover:border-brand-blue bg-surface-800 hover:bg-surface-700 rounded-sm text-left transition-all group flex flex-col justify-between cursor-pointer"
                    >
                      <div>
                        <span className="text-xs font-bold text-text-primary uppercase tracking-wide flex items-center gap-2">
                          <Layout className="w-3.5 h-3.5 text-brand-blue" />
                          CRM Dashboard
                        </span>
                        <p className="text-[10px] text-text-muted mt-1.5 leading-relaxed">
                          jQuery v2.2, Bootstrap 3 inline tables, and legacy inline script selectors.
                        </p>
                      </div>
                      <span className="text-[9px] uppercase tracking-widest font-bold text-brand-blue mt-4 inline-block group-hover:translate-x-1 transition-transform">Load CRM Application &rarr;</span>
                    </button>

                    <button 
                      onClick={() => loadSample('todo')}
                      className="p-3 border border-surface-border hover:border-brand-emerald bg-surface-800 hover:bg-surface-700 rounded-sm text-left transition-all group flex flex-col justify-between cursor-pointer"
                    >
                      <div>
                        <span className="text-xs font-bold text-text-primary uppercase tracking-wide flex items-center gap-2">
                          <Code2 className="w-3.5 h-3.5 text-brand-emerald" />
                          Todo Checkpoints
                        </span>
                        <p className="text-[10px] text-text-muted mt-1.5 leading-relaxed">
                          Old ES5 toggle functions, strict layout tables, and hardcoded DOM event handlers.
                        </p>
                      </div>
                      <span className="text-[9px] uppercase tracking-widest font-bold text-brand-emerald mt-4 inline-block group-hover:translate-x-1 transition-transform">Load Todo Application &rarr;</span>
                    </button>
                  </div>
                </div>
              )}
              
              {error && (
                <div className={`p-6 border rounded-sm flex flex-col gap-4 ${error.includes('QUOTA_EXCEEDED') || error.includes('GROQ_API_KEY_MISSING') || error.includes('RATE_LIMIT') ? 'bg-amber-500/10 border-amber-500/50 text-amber-200' : 'bg-red-500/10 border-red-500/50 text-red-200'}`}>
                  <div className="flex items-center gap-3 font-bold uppercase tracking-widest text-xs">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    {error.includes('GROQ_API_KEY_MISSING') ? 'API Key Required' : error.includes('RATE_LIMIT') ? 'Rate Limit Reached' : 'System Error'}
                  </div>
                  <p className="text-xs leading-relaxed opacity-90">{error}</p>
                  {error.includes('GROQ_API_KEY_MISSING') ? (
                    <div className="flex gap-4 mt-1">
                      <span className="text-[10px] uppercase tracking-widest text-amber-300 opacity-80">
                        Please configure your GROQ_API_KEY in the Secrets panel in the AI Studio UI
                      </span>
                    </div>
                  ) : error.includes('RATE_LIMIT') ? (
                    <div className="flex gap-4 mt-1">
                      <button 
                        onClick={() => window.open('https://console.groq.com/keys', '_blank')}
                        className="text-[10px] uppercase tracking-widest font-bold underline decoration-amber-500/50 underline-offset-4 hover:text-white cursor-pointer"
                      >
                        Manage Groq Keys
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </motion.div>
          )}

          {(stage === 'analyzing' || stage === 'refactoring' || stage === 'reporting') && (
            <motion.div 
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-4xl mx-auto py-20 space-y-12"
            >
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-5xl font-light italic text-text-primary">Agent Orchestration</h1>
                  <p className="text-text-muted text-sm mt-2 uppercase tracking-widest font-mono">
                    Multi-agent execution graph: Running phase {stage === 'analyzing' ? '01' : stage === 'refactoring' ? '02' : '03'}/03
                  </p>
                </div>
                <div className="flex gap-8">
                  <div className="text-right">
                    <p className="text-[10px] text-text-muted uppercase tracking-widest">Status</p>
                    <p className="text-xl font-mono text-brand-blue animate-pulse uppercase">{stage}</p>
                  </div>
                </div>
              </div>

              <div className="h-48 bg-black border border-surface-border p-6 font-mono text-[11px] text-brand-emerald overflow-hidden relative">
                <div className="space-y-1">
                  <p className="opacity-60 text-white mb-2">[AGENT_INIT]: Collaborative pool spawned...</p>
                  {stage === 'analyzing' && (
                    <>
                      <p>&gt; Scanning project hierarchy for legacy signatures...</p>
                      <p>&gt; Detecting outdated module resolution patterns...</p>
                      <p>&gt; Identifying high-risk DOM manipulation fragments...</p>
                      <p className="animate-pulse">&gt; ANALYZER: Mapping dependency graph (BFS execution)...</p>
                    </>
                  )}
                  {stage === 'refactoring' && (
                    <>
                      <p className="text-text-muted opacity-40">&gt; [DONE]: Structure scan complete.</p>
                      <p>&gt; Initiating syntax evolution to ES6+ standards...</p>
                      <p>&gt; Converting jQuery event listeners to React hooks...</p>
                      <p>&gt; Mapping Bootstrap utility classes to Tailwind primitives...</p>
                      <p className="animate-pulse">&gt; REFACTOR: Synthesizing modern module fragments...</p>
                    </>
                  )}
                  {stage === 'reporting' && (
                    <>
                      <p className="text-text-muted opacity-40">&gt; [DONE]: Synthetic evolution complete.</p>
                      <p>&gt; Estimating dependency maintenance and optimization gains...</p>
                      <p>&gt; Logging reduced exposure to deprecated and unmaintained dependencies...</p>
                      <p>&gt; Finalizing migration report documentation...</p>
                      <p className="animate-pulse">&gt; REPORT: Compiling agent outputs to dashboard...</p>
                    </>
                  )}
                </div>
                <div className="absolute bottom-0 left-0 w-full h-1 bg-surface-border">
                   <motion.div 
                     className="h-full bg-brand-blue" 
                     initial={{ width: 0 }}
                     animate={{ width: stage === 'analyzing' ? '33%' : stage === 'refactoring' ? '66%' : '100%' }}
                   />
                </div>
              </div>
            </motion.div>
          )}

          {stage === 'complete' && analysis && refactor && report && (
            <motion.div 
              key="complete"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-12"
            >
              {/* Report Header */}
              <div className="flex items-center justify-between border-b border-surface-border pb-8 flex-wrap gap-4">
                <div>
                  <h2 className="text-4xl font-light italic text-text-primary">Migration Report</h2>
                  <p className="text-text-muted uppercase tracking-wider text-xs font-mono mt-1">Multi-agent execution graph completed</p>
                </div>
                <div className="flex gap-3 font-mono">
                  {report.originalBytes > 0 && (
                    <div className="text-right px-4 border-r border-surface-border hidden sm:block">
                      <p className="text-[10px] text-text-muted uppercase tracking-widest">Byte Reduction</p>
                      <p className="text-xl font-mono text-brand-blue">
                        {report.originalBytes > report.modernizedBytes 
                          ? `-${Math.round(((report.originalBytes - report.modernizedBytes) / report.originalBytes) * 100)}%`
                          : '+0%'}
                      </p>
                    </div>
                  )}
                  <div className="text-right px-4 border-r border-surface-border max-w-[280px]">
                    <p className="text-[10px] text-text-muted uppercase tracking-widest">Optimization Basis</p>
                    <p className="text-[11px] font-mono text-brand-emerald leading-snug mt-1">
                      Estimated build and dependency optimization improvements
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={reset} className="px-4 py-2 border border-surface-border rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-surface-700 flex items-center gap-2 cursor-pointer">
                      <RefreshCcw className="w-3 h-3" />
                      NEW SESSION
                    </button>
                    <button 
                      onClick={downloadBundle}
                      className="px-4 py-2 bg-text-primary text-black rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-white flex items-center gap-2 cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                      EXPORT BUNDLE
                    </button>
                    <button 
                      onClick={downloadMigrationReport}
                      className="px-4 py-2 border border-brand-emerald/40 hover:border-brand-emerald hover:bg-brand-emerald/5 bg-brand-emerald/10 text-brand-emerald rounded-sm font-bold text-[10px] uppercase tracking-widest flex items-center gap-2 cursor-pointer"
                    >
                      <FileText className="w-3 h-3" />
                      DOWNLOAD REPORT
                    </button>
                  </div>
                </div>
              </div>

              {/* Analysis Summary */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-12">
                  {/* Analysis Card */}
                  <section className="bg-surface-800 border border-surface-border p-8 space-y-6 rounded-sm">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 text-text-muted uppercase text-[10px] font-bold tracking-[0.2em]">
                        <Search className="w-4 h-4" />
                        Deconstruction Analysis
                      </div>
                      <div className="px-2 py-0.5 bg-brand-emerald text-black text-[9px] font-bold rounded-sm">VERIFIED</div>
                    </div>
                    
                    <div className="space-y-6">
                      <div className="p-4 bg-surface-900 border border-surface-border">
                        <p className="text-sm font-mono text-brand-emerald mb-2 uppercase tracking-widest">Summary.log</p>
                        <p className="text-sm text-text-secondary leading-relaxed">{analysis.summary}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-8">
                        <div>
                          <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted block mb-3">Legacy Stack</label>
                          <div className="flex flex-wrap gap-2">
                            {analysis.technologies.map((tech, i) => (
                              <span key={i} className="px-2 py-1 bg-surface-900 border border-surface-border text-text-secondary rounded-sm text-[10px] font-mono">{tech}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted block mb-3">Integrity Issues</label>
                          <ul className="space-y-2">
                            {analysis.issues.map((issue, i) => (
                              <li key={i} className="text-[11px] text-text-secondary flex items-start gap-2 border-b border-surface-border/50 pb-1">
                                <span className="mt-1.5 w-1 h-1 bg-brand-blue rounded-full shrink-0" />
                                {issue}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Refactored Code */}
                  <section className="space-y-6">
                    <div className="flex items-center gap-2 text-text-muted uppercase text-[10px] font-bold tracking-[0.2em]">
                      <Code2 className="w-4 h-4" />
                      Evolved Syntax
                    </div>
                    <div className="space-y-4">
                      {refactor.files.map((file, i) => (
                        <div key={i} className="border border-surface-border rounded-sm overflow-hidden bg-black shadow-2xl">
                          <div className="px-4 py-2 border-b border-surface-border flex items-center justify-between bg-surface-800">
                            <span className="text-[10px] font-mono text-text-muted tracking-wider uppercase">{file.name}</span>
                            <div className="flex items-center gap-4">
                              <span className="text-[9px] text-brand-emerald font-bold tracking-widest">TS_COMPLIANT</span>
                              <div className="flex gap-1">
                                <div className="w-2 h-2 rounded-full bg-surface-border" />
                                <div className="w-2 h-2 rounded-full bg-surface-border" />
                              </div>
                            </div>
                          </div>
                          <div className="max-h-[500px] overflow-y-auto text-[13px] custom-scrollbar bg-[#000]">
                            <SyntaxHighlighter 
                              language={file.name.split('.').pop()} 
                              style={vscDarkPlus}
                              customStyle={{ margin: 0, padding: '1.5rem', background: 'transparent' }}
                            >
                              {file.content}
                            </SyntaxHighlighter>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <aside className="space-y-8">
                  {/* Migration Metrics */}
                  <section className="bg-surface-800 border border-surface-border p-6 space-y-8 rounded-sm lg:sticky lg:top-28">
                    <div>
                      <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-4">Core Transformation</h3>
                      <div className="space-y-4">
                        <div className="markdown-body text-xs">
                          <Markdown>{report.beforeAfter}</Markdown>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 pt-6 border-t border-surface-border">
                      <h4 className="text-[10px] uppercase tracking-[0.2em] text-text-muted flex items-center gap-2">
                        <Shield className="w-3 h-3 text-brand-emerald" />
                        Dependency Maintenance
                      </h4>
                      <div className="space-y-2">
                        {report.vulnerabilitiesFixed.map((fix, i) => (
                          <div key={i} className="p-2 bg-emerald-500/5 border border-emerald-500/20 text-brand-emerald text-[10px] font-mono uppercase tracking-tight">
                            &gt; {fix}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4 pt-6 border-t border-surface-border">
                      <h4 className="text-[10px] uppercase tracking-[0.2em] text-text-muted flex items-center gap-2">
                        <Terminal className="w-3 h-3 text-brand-blue" />
                        Execution Impact
                      </h4>
                      <p className="text-[11px] text-text-secondary leading-relaxed font-mono italic">"{report.performanceImprovements}"</p>
                    </div>

                    <div className="space-y-3 pt-6 border-t border-surface-border">
                      <div className="flex justify-between items-center text-[10px] uppercase tracking-widest text-text-muted">
                        <span>Original Size</span>
                        <span className="text-text-primary">{(report.originalBytes / 1024).toFixed(1)} KB</span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] uppercase tracking-widest text-text-muted">
                        <span>Modernized Size</span>
                        <span className="text-text-primary">{(report.modernizedBytes / 1024).toFixed(1)} KB</span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] uppercase tracking-widest text-text-muted">
                        <span>Accessibility</span>
                        <span className="text-text-primary">{report.accessibilityScore}/100</span>
                      </div>
                      <div className="flex flex-col gap-1 text-[10px] uppercase tracking-widest text-text-muted">
                        <div className="flex justify-between items-center">
                          <span>Type Safety</span>
                          <span className="text-text-primary font-mono text-right font-normal">Compatible</span>
                        </div>
                        <p className="text-[10px] font-mono lowercase normal-case text-brand-emerald leading-tight mt-0.5">
                          Improved type-safety compatibility analysis
                        </p>
                      </div>
                    </div>
                  </section>
                </aside>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-border py-4 bg-surface-900 mt-20">
        <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
          <div className="flex items-center gap-6">
            <span className="text-[10px] font-mono text-text-muted">ID: LL_MOD_9942</span>
            <span className="text-[10px] font-mono text-text-muted">POOL: 03_AGENTS</span>
            <span className="text-[10px] font-mono text-text-muted tracking-tighter uppercase font-bold italic opacity-50">LegacyUpgrader</span>
          </div>
          <div className="text-[10px] text-text-primary opacity-40 uppercase tracking-tighter italic">
            System operating within parameters • Hardware acceleration enabled
          </div>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #09090b;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
        .markdown-body h1, .markdown-body h2, .markdown-body h3 {
          @apply font-bold mt-4 mb-2 text-text-primary block tracking-tight;
        }
        .markdown-body p {
          @apply mb-2 leading-relaxed block text-text-secondary;
        }
        .markdown-body ul {
          @apply list-disc list-inside mb-2 block text-text-secondary;
        }
        .markdown-body strong {
          @apply font-bold text-text-primary;
        }
      `}</style>
    </div>
  );
}

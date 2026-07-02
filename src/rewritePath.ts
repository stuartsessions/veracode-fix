import fs from 'fs';
import path from 'path';

interface Options {
    DEBUG?: string;
}

export async function rewritePath(options: Options, filename: string): Promise<string | undefined> {
    // Legacy function - now just returns the original filename
    // Auto-detection is handled in createFlawInfo.ts
    return filename;
}

interface QueueItem {
    path: string;
    depth: number;
}

/**
 * Parse relative path into components, normalizing leading slashes
 */
function parseRelativePath(relativePath: string): string[] {
    // Remove leading ./ or /
    let normalized = relativePath;
    if (normalized.startsWith('./')) {
        normalized = normalized.substring(2);
    } else if (normalized.startsWith('/')) {
        normalized = normalized.substring(1);
    }

    // Split by path separator
    return normalized.split(path.sep).filter(component => component.length > 0);
}

/**
 * Check if directory should be excluded from search
 */
function shouldExcludeDirectory(dirName: string): boolean {
    const excludedDirs = new Set([
        '.git', '.metadata', 'app', 'node_modules', 'dist', 'target',
        'build', '.next', '.cache', 'bin', 'obj', 'out', 'vendor',
        'venv', '__pycache__', '.venv', '.pytest_cache', 'coverage',
        '.nyc_output', '.svn', '.hg'
    ]);
    return excludedDirs.has(dirName);
}

/**
 * Try to resolve the full path from a base directory using path components
 */
function tryResolvePath(baseDir: string, pathComponents: string[]): string | null {
    let currentPath = baseDir;

    for (let i = 0; i < pathComponents.length; i++) {
        const component = pathComponents[i];
        const nextPath = path.join(currentPath, component);

        // Check if path exists
        if (!fs.existsSync(nextPath)) {
            return null;
        }

        try {
            const stat = fs.statSync(nextPath);

            // Last component should be a file
            if (i === pathComponents.length - 1) {
                if (stat.isFile()) {
                    return nextPath;
                } else {
                    return null;
                }
            } else {
                // Intermediate components should be directories
                if (!stat.isDirectory()) {
                    return null;
                }
            }

            currentPath = nextPath;
        } catch (err) {
            return null;
        }
    }

    return null;
}

/**
 * Search for file using BFS with relative path structure
 */
async function searchFileWithBFS(rootDir: string, relativePath: string, options: Options): Promise<string | null> {
    const pathComponents = parseRelativePath(relativePath);

    if (options.DEBUG === 'true') {
        console.log('#######- DEBUG MODE -#######');
        console.log('rewritePath.ts - searchFileWithBFS');
        console.log(`Searching for: ${relativePath}`);
        console.log(`Root directory: ${rootDir}`);
        console.log(`Path components: ${JSON.stringify(pathComponents)}`);
        console.log('#######- DEBUG MODE -#######');
    }

    // If only one component (filename only), search for it directly
    if (pathComponents.length === 1) {
        const filename = pathComponents[0];
        if (options.DEBUG === 'true') {
            console.log(`Single filename detected: ${filename}, searching for file directly`);
        }

        const queue: QueueItem[] = [{path: rootDir, depth: 0}];
        const visited = new Set<string>();
        const maxDepth = 15;

        while (queue.length > 0) {
            const {path: currentPath, depth} = queue.shift()!;

            if (depth > maxDepth || visited.has(currentPath)) {
                continue;
            }

            visited.add(currentPath);

            try {
                const entries = fs.readdirSync(currentPath);

                for (const entry of entries) {
                    if (shouldExcludeDirectory(entry)) {
                        continue;
                    }

                    const fullPath = path.join(currentPath, entry);

                    try {
                        const stat = fs.statSync(fullPath);

                        if (stat.isFile() && entry === filename) {
                            if (options.DEBUG === 'true') {
                                console.log(`Found file: ${fullPath}`);
                            }
                            return fullPath;
                        }

                        if (stat.isDirectory()) {
                            queue.push({path: fullPath, depth: depth + 1});
                        }
                    } catch (err) {
                        continue;
                    }
                }
            } catch (err) {
                continue;
            }
        }

        return null;
    }

    const topLevelDir = pathComponents[0];
    const remainingPath = pathComponents.slice(1);

    if (options.DEBUG === 'true') {
        console.log(`Looking for top-level folder: ${topLevelDir}`);
    }

    const queue: QueueItem[] = [{path: rootDir, depth: 0}];
    const visited = new Set<string>();
    const maxDepth = 10;

    while (queue.length > 0) {
        const {path: currentPath, depth} = queue.shift()!;

        // Skip if too deep or already visited
        if (depth > maxDepth || visited.has(currentPath)) {
            continue;
        }

        visited.add(currentPath);

        try {
            const entries = fs.readdirSync(currentPath);

            for (const entry of entries) {
                // Skip excluded directories
                if (shouldExcludeDirectory(entry)) {
                    continue;
                }

                const fullPath = path.join(currentPath, entry);

                try {
                    const stat = fs.statSync(fullPath);

                    if (stat.isDirectory()) {
                        // Check if this directory matches our top-level folder
                        if (entry === topLevelDir) {
                            if (options.DEBUG === 'true') {
                                console.log(`Found candidate folder: ${fullPath}`);
                            }

                            // Try to resolve the remaining path from here
                            const resolvedPath = tryResolvePath(fullPath, remainingPath);

                            if (resolvedPath) {
                                if (options.DEBUG === 'true') {
                                    console.log(`Successfully resolved path: ${resolvedPath}`);
                                }
                                return resolvedPath;
                            } else if (options.DEBUG === 'true') {
                                console.log(`Failed to resolve path from ${fullPath}, continuing search`);
                            }

                            // Add to queue to continue exploring inside this directory
                            queue.push({path: fullPath, depth: depth + 1});
                        } else {
                            // Add other directories to queue for continued exploration
                            queue.push({path: fullPath, depth: depth + 1});
                        }
                    }
                } catch (err) {
                    // Skip files/directories we can't stat
                    continue;
                }
            }
        } catch (err) {
            // Skip directories we can't read
            if (options.DEBUG === 'true') {
                console.log(`Cannot read directory ${currentPath}`);
            }
            continue;
        }
    }

    return null;
}

export async function searchFile(dir: string, filename: string, options: Options): Promise<string> {
    if (options.DEBUG === 'true') {
        console.log('#######- DEBUG MODE -#######');
        console.log('rewritePath.ts - searchFile()');
        console.log(`Searching for file: ${filename} in directory: ${dir}`);
        console.log('#######- DEBUG MODE -#######');
    }

    // Use BFS with relative path structure
    const bfsResult = await searchFileWithBFS(dir, filename, options);

    if (bfsResult) {
        console.log(`File found: ${bfsResult}`);
        return bfsResult;
    }

    // BFS failed - file not found
    console.log(`File not found: ${filename}`);
    if (options.DEBUG === 'true') {
        console.log('#######- DEBUG MODE -#######');
        console.log('rewritePath.ts - searchFile()');
        console.log(`BFS search failed for: ${filename}`);
        console.log(`Searched from directory: ${dir}`);
        console.log(`File ${filename} not found in directory tree`);
        console.log('#######- DEBUG MODE -#######');
    }

    return '';
}

/**
 * Normalizes file paths by removing GitHub Actions runner working directory prefix
 * and returning only the relative path from the repository root
 */
export function normalizePathForDisplay(fullPath: string, repositoryRoot?: string): string {
    if (!fullPath) {
        return fullPath;
    }

    // If repositoryRoot is provided, use it as the base
    if (repositoryRoot) {
        const relativePath = path.relative(repositoryRoot, fullPath);
        return relativePath.startsWith('..') ? fullPath : relativePath;
    }

    // Try to detect GitHub Actions runner paths
    const githubActionsPatterns = [
        /^\/home\/runner\/work\/[^\/]+\/[^\/]+\/(.+)$/,  // /home/runner/work/repo-owner/repo-name/...
        /^\/github\/workspace\/(.+)$/,                   // /github/workspace/...
        /^\/Users\/[^\/]+\/work\/[^\/]+\/[^\/]+\/(.+)$/ // /Users/username/work/repo-owner/repo-name/...
    ];

    for (const pattern of githubActionsPatterns) {
        const match = fullPath.match(pattern);
        if (match) {
            return match[1];
        }
    }

    // If no pattern matches, try to find the repository root by looking for .git directory
    let currentDir = path.dirname(fullPath);
    while (currentDir !== path.dirname(currentDir)) {
        if (fs.existsSync(path.join(currentDir, '.git'))) {
            const relativePath = path.relative(currentDir, fullPath);
            return relativePath;
        }
        currentDir = path.dirname(currentDir);
    }

    // If all else fails, return the original path
    return fullPath;
}
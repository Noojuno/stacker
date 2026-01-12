/**
 * Git commit message trailer parsing and manipulation
 * 
 * Trailers are key-value pairs at the end of commit messages, like:
 * 
 * Stacker-Branch: feature/stack/1
 * Stacker-PR: 123
 * Stacker-Depends-On: other-feature
 */

/** Trailer key prefix for stacker metadata */
const TRAILER_PREFIX = "Stacker-";

/** Known trailer keys */
export const TRAILER_KEYS = {
  BRANCH: `${TRAILER_PREFIX}Branch`,
  PR: `${TRAILER_PREFIX}PR`,
  DEPENDS_ON: `${TRAILER_PREFIX}Depends-On`,
} as const;

/**
 * Parse trailers from a commit message body
 * Returns a Map of trailer key -> value
 */
export function parseTrailers(commitMessage: string): Map<string, string> {
  const trailers = new Map<string, string>();
  const lines = commitMessage.split("\n");
  
  // Trailers are at the end of the message, after a blank line
  // Find the last paragraph (block of non-empty lines at the end)
  let inTrailerBlock = false;
  
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    
    if (!line) {
      // Empty line - we've exited the trailer block going backwards
      if (inTrailerBlock) break;
      continue;
    }
    
    // Check if this line matches trailer format: "Key: Value"
    const match = line.match(/^([A-Za-z][A-Za-z0-9-]*): (.+)$/);
    if (match) {
      inTrailerBlock = true;
      const [, key, value] = match;
      // Only store if not already seen (we're going backwards)
      if (!trailers.has(key!)) {
        trailers.set(key!, value!);
      }
    } else if (inTrailerBlock) {
      // Non-trailer line while in trailer block - exit
      break;
    }
  }
  
  return trailers;
}

/**
 * Get only Stacker-* trailers from a commit message
 */
export function getStackerTrailers(commitMessage: string): Map<string, string> {
  const allTrailers = parseTrailers(commitMessage);
  const stackerTrailers = new Map<string, string>();
  
  for (const [key, value] of allTrailers) {
    if (key.startsWith(TRAILER_PREFIX)) {
      stackerTrailers.set(key, value);
    }
  }
  
  return stackerTrailers;
}

/**
 * Add or update trailers in a commit message
 * Preserves existing non-Stacker trailers
 */
export function setTrailers(
  commitMessage: string,
  trailers: Map<string, string>
): string {
  const lines = commitMessage.split("\n");
  
  // Find where trailers start (if any)
  let trailerStartIndex = lines.length;
  let foundBlankBeforeTrailers = false;
  
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    
    if (!line) {
      if (trailerStartIndex < lines.length) {
        // Found blank line before trailers
        foundBlankBeforeTrailers = true;
        break;
      }
      continue;
    }
    
    if (/^[A-Za-z][A-Za-z0-9-]*: .+$/.test(line)) {
      trailerStartIndex = i;
    } else {
      break;
    }
  }
  
  // Parse existing trailers
  const existingTrailers = new Map<string, string>();
  for (let i = trailerStartIndex; i < lines.length; i++) {
    const line = lines[i];
    const match = line?.match(/^([A-Za-z][A-Za-z0-9-]*): (.+)$/);
    if (match) {
      existingTrailers.set(match[1]!, match[2]!);
    }
  }
  
  // Merge trailers (new ones override existing)
  const mergedTrailers = new Map([...existingTrailers, ...trailers]);
  
  // Build the message body without old trailers
  let bodyLines = lines.slice(0, trailerStartIndex);
  
  // Remove trailing empty lines from body
  while (bodyLines.length > 0 && !bodyLines[bodyLines.length - 1]) {
    bodyLines.pop();
  }
  
  // Add trailers
  const trailerLines = Array.from(mergedTrailers.entries()).map(
    ([key, value]) => `${key}: ${value}`
  );
  
  if (trailerLines.length > 0) {
    return [...bodyLines, "", ...trailerLines].join("\n");
  }
  
  return bodyLines.join("\n");
}

/**
 * Remove all Stacker-* trailers from a commit message
 */
export function stripStackerTrailers(commitMessage: string): string {
  const lines = commitMessage.split("\n");
  const resultLines: string[] = [];
  
  let inTrailerBlock = false;
  let trailerBlockStart = -1;
  const nonStackerTrailers: string[] = [];
  
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    
    if (!line) {
      if (inTrailerBlock) {
        trailerBlockStart = i + 1;
        break;
      }
      continue;
    }
    
    const match = line.match(/^([A-Za-z][A-Za-z0-9-]*): (.+)$/);
    if (match) {
      inTrailerBlock = true;
      const key = match[1]!;
      if (!key.startsWith(TRAILER_PREFIX)) {
        nonStackerTrailers.unshift(line);
      }
    } else if (inTrailerBlock) {
      trailerBlockStart = i + 1;
      break;
    }
  }
  
  // If no trailer block found, return original
  if (trailerBlockStart === -1) {
    return commitMessage;
  }
  
  // Build result: body + non-stacker trailers
  const body = lines.slice(0, trailerBlockStart);
  
  // Remove trailing empty lines from body
  while (body.length > 0 && !body[body.length - 1]) {
    body.pop();
  }
  
  if (nonStackerTrailers.length > 0) {
    return [...body, "", ...nonStackerTrailers].join("\n");
  }
  
  return body.join("\n");
}

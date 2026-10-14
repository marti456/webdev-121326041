const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');

// The lectures, read once when the server starts.
const lectures = JSON.parse(fs.readFileSync(path.join(__dirname, 'lectures.json'), 'utf8'));

// A tool result: one text part, and whether the tool failed.
function textResult(id, text, isError) {
  return { jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: text }], isError: isError } };
}

// A protocol error: the message itself is wrong.
function errorReply(id, code, message) {
  return { jsonrpc: '2.0', id: id, error: { code: code, message: message } };
}

// The tools this server offers. The description is what the model reads to choose.
const tools = [
  {
    name: 'find_lecture',
    description:
      'Return the title and topics of one course lecture by its number, 1 to 10. ' +
      'Use it when asked what a specific lecture covers. Returns one line of text.',
    inputSchema: {
      type: 'object',
      properties: { number: { type: 'integer', description: 'Lecture number, 1 to 10' } },
      required: ['number'],
    },
  },
  {
    name: 'search_lectures',
    description:
      'Search all course lectures for a keyword in their title or topics, case-insensitive. ' +
      'Use it when asked which lecture covers a subject (for example "MCP" or "testing") and the number is not known. ' +
      'Returns one line per matching lecture with its number, title and topics, or a message that nothing matched.',
    inputSchema: {
      type: 'object',
      properties: { keyword: { type: 'string', description: 'A word or phrase to look for, e.g. "security"' } },
      required: ['keyword'],
    },
  },
];

// Print one reply as one line of JSON on stdout. process.stdout.write flushes on each call.
function send(reply) {
  process.stdout.write(JSON.stringify(reply) + '\n');
}

// Run one tool call and return its reply.
function callTool(id, name, args) {
  if (name === 'find_lecture') {
    const lecture = lectures.find((l) => l.number === args.number);
    if (!lecture) {
      // The tool ran and failed: a normal result the model can read, marked isError.
      return textResult(id, 'There is no lecture ' + args.number + '. The course has lectures 1 to 10.', true);
    }
    return textResult(id, 'Lecture ' + lecture.number + ': ' + lecture.title + '. Topics: ' + lecture.topics, false);
  }
  if (name === 'search_lectures') {
    const keyword = String(args.keyword || '').trim().toLowerCase();
    if (!keyword) {
      return textResult(id, 'Give a keyword to search for, for example "MCP".', true);
    }
    const found = lectures.filter((l) => (l.title + ' ' + l.topics).toLowerCase().includes(keyword));
    if (found.length === 0) {
      return textResult(id, 'No lecture mentions "' + args.keyword + '".', false);
    }
    const text = found.map((l) => 'Lecture ' + l.number + ': ' + l.title + '. Topics: ' + l.topics).join('\n');
    return textResult(id, text, false);
  }
  // A tool we never offered: the message itself is wrong, so it is a protocol error.
  return errorReply(id, -32602, 'Unknown tool: ' + name);
}

// Decide what to answer. Return the reply, or null to answer nothing.
function handle(msg) {
  if (msg.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'lectures', version: '0.1.0' },
      },
    };
  }
  if (msg.method === 'notifications/initialized') {
    return null; // a notification: it has no id and gets no reply
  }
  if (msg.method === 'tools/list') {
    return { jsonrpc: '2.0', id: msg.id, result: { tools: tools } };
  }
  if (msg.method === 'tools/call') {
    const params = msg.params || {};
    return callTool(msg.id, params.name, params.arguments || {});
  }
  if (msg.id !== undefined) {
    // Any other request we do not know.
    return errorReply(msg.id, -32601, 'Unknown method: ' + msg.method);
  }
  return null; // an unknown notification: ignore it
}

const lines = readline.createInterface({ input: process.stdin });

lines.on('line', (line) => {
  // Log to stderr. Never print to stdout: the client reads stdout as protocol.
  console.error('got: ' + line);
  if (line.trim() === '') return;

  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    send(errorReply(null, -32700, 'Parse error'));
    return;
  }

  try {
    const reply = handle(msg);
    if (reply) send(reply);
  } catch (err) {
    // Never crash: report the failure and keep reading.
    console.error('error: ' + err.stack);
    if (msg.id !== undefined) send(errorReply(msg.id, -32603, 'Internal error'));
  }
});

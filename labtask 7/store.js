// Step 26: Store student records in a JSON file using fs/promises.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
function createStore(file) {
  let writeQueue = Promise.resolve();
  async function loadFromFile() {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  async function list() {
    await writeQueue; // Wait for any earlier edits.
    return loadFromFile();
  }
  function edit(change) {
    const operation = writeQueue.then(async () => {
      const students = await loadFromFile();
      const result = change(students);
      if (result.changed) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temp = `${file}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temp, JSON.stringify(students, null, 2), 'utf8');
          await fs.rename(temp, file);
        } catch (error) {
          await fs.rm(temp, { force: true }).catch(() => {});
          throw error;
        }
      }
      return result.value;
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  return { list, edit };
}
module.exports = { createStore };

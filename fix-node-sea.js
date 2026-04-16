const fs = require('fs');
const path = require('path');

// Crea la directory externals se non esiste
const externalsDir = path.join(__dirname, '.expo', 'metro', 'externals');

try {
  // Crea la directory con recursive: true
  if (!fs.existsSync(externalsDir)) {
    fs.mkdirSync(externalsDir, { recursive: true });
  }
  
  // Rimuovi eventuali file node_sea esistenti (creati da versioni precedenti dello script)
  // Expo deve creare una directory, non un file
  const nodeSeaPath = path.join(externalsDir, 'node_sea');
  if (fs.existsSync(nodeSeaPath)) {
    const stats = fs.statSync(nodeSeaPath);
    if (stats.isFile()) {
      fs.unlinkSync(nodeSeaPath);
      console.log('✓ Removed old node_sea file');
    }
  }
  
  console.log('✓ Prepared externals directory for Windows');
} catch (error) {
  console.error('Error fixing node:sea:', error.message);
}


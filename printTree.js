const fs = require("fs");
const path = require("path");

function printTree(dir, prefix = "") {
  const files = fs.readdirSync(dir);
  files.forEach((file, index) => {
    const isLast = index === files.length - 1;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    console.log(prefix + (isLast ? "└── " : "├── ") + file);
    if (stat.isDirectory()) {
      printTree(filePath, prefix + (isLast ? "    " : "│   "));
    }
  });
}

printTree(".");

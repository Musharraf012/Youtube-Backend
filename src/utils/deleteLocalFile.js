import fs from "fs";

export const deleteLocalFile = (filePath) => {
    try {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted local file: ${filePath}`);
        }
    } catch (err) {
        console.error("Error deleting file:", err.message);
    }
};

// paper-script.js

function downloadPaper() {
    alert('Downloading paper...\n\nIn production, this would download your PDF file.');

    const link = document.createElement('a');
    link.href = './papers/your-paper.pdf';
    link.download = 'Your_Paper_Title.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function copyCitation() {
    const citation = 'Your Name and Co-Author Name (2024). "Your Paper Title: A Comprehensive Analysis of Financial Markets." Working Paper.';
    
    navigator.clipboard.writeText(citation).then(() => {
        // Change button text temporarily
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.backgroundColor = 'var(--success-color)';
        
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.backgroundColor = '';
        }, 2000);
    }).catch(err => {
        alert('Failed to copy citation. Please copy manually.');
    });
}

function copyBibtex() {
    const bibtex = `@article{yourname2024paper,
  title={Your Paper Title: A Comprehensive Analysis of Financial Markets},
  author={Your Name and Co-Author Name},
  year={2024},
  note={Working Paper}
}`;
    
    navigator.clipboard.writeText(bibtex).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    }).catch(err => {
        alert('Failed to copy BibTeX. Please copy manually.');
    });
}
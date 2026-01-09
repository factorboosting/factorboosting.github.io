// paper-script.js

function downloadPaper() {
    const link = document.createElement('a');
    link.href = 'Data/Papers/AMES_Portfolio_Optimization.pdf';
    link.download = 'Factor_Boosting&Portfolio_Optimization.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function copyCitation() {
    const citation = 'Foujdar, A., Juneja, S., Kumar, A., Prabhala, N., & Wagle, S. (2025). Portfolio optimization using anomalies: A deep learning approach. Working paper (Submitted).';
    
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
    const bibtex = `@article{finfactor2025paper,
  title={Portfolio optimization using anomalies: A deep learning approach},
  author={Foujdar, A., Juneja, S., Kumar, A., Prabhala, N., & Wagle, S.},
  year={2025},
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

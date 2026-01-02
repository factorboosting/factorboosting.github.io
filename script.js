// script.js - UPDATED VERSION

// Sample data - Replace with your actual research data
const publicationsData = [
    {
        title: "Portfolio Optimization using Anomalies: A Deep Learning Approach",
        venue: "(Working Paper)",
        year: 2026,
        citations: 0,
        type: "conference",
        links: {
            paper: "#",
            code: "#"
        }
    },
    {
        title: "Novel Methods in Neural Architecture Search",
        venue: "NeurIPS 2023",
        year: 2023,
        citations: 42,
        type: "conference",
        links: {
            paper: "#",
            code: "#",
            slides: "#"
        }
    },
    {
        title: "Attention Mechanisms in Transformers",
        venue: "IEEE Trans. PAMI",
        year: 2023,
        citations: 78,
        type: "journal",
        links: {
            paper: "#"
        }
    },
    {
        title: "Efficient Training of Large Scale Models",
        venue: "ICML 2023",
        year: 2023,
        citations: 35,
        type: "conference",
        links: {
            paper: "#",
            code: "#"
        }
    },
    {
        title: "Advances in Few-Shot Learning",
        venue: "arXiv",
        year: 2024,
        citations: 8,
        type: "preprint",
        links: {
            paper: "#"
        }
    }
];

// Set last updated date
function setLastUpdated() {
    const date = new Date();
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    document.getElementById('lastUpdated').textContent = date.toLocaleDateString('en-US', options);
}

// Populate publications table
function populateTable(tableId, data) {
    const tbody = document.getElementById(tableId);
    tbody.innerHTML = '';

    data.forEach(pub => {
        const row = document.createElement('tr');
        
        const linksHtml = Object.entries(pub.links)
            .map(([key, url]) => `<a href="${url}" class="link">${key.charAt(0).toUpperCase() + key.slice(1)}</a>`)
            .join(' • ');

        row.innerHTML = `
            <td><strong>${pub.title}</strong></td>
            <td>${pub.venue}</td>
            <td>${pub.year}</td>
            <td>${pub.citations}</td>
            <td>${linksHtml}</td>
        `;

        tbody.appendChild(row);
    });
}

// Filter publications by type
function filterPublications(type) {
    if (type === 'all') {
        return publicationsData;
    }
    return publicationsData.filter(pub => pub.type === type);
}

// Universal tab functionality for all sections
function initTabs() {
    // Get all sections with tabs
    const sections = document.querySelectorAll('.section');
    
    sections.forEach(section => {
        const tabBtns = section.querySelectorAll('.tab-btn');
        const tabContents = section.querySelectorAll('.tab-content');
        
        if (tabBtns.length === 0) return; // Skip sections without tabs
        
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;
                
                // Remove active class from all tabs and contents in this section
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                // Add active class to clicked tab and corresponding content
                btn.classList.add('active');
                const activeContent = section.querySelector(`[data-content="${tabName}"]`);
                if (activeContent) {
                    activeContent.classList.add('active');
                }
                
                // Special handling for publications section
                if (section.id === 'publications') {
                    const filteredData = filterPublications(tabName);
                    const tableId = tabName === 'all' ? 'publicationsTable' : `${tabName}Table`;
                    populateTable(tableId, filteredData);
                }
            });
        });
    });
}

// Smooth scrolling for navigation links
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    setLastUpdated();
    populateTable('publicationsTable', publicationsData);
    initTabs();
    initSmoothScroll();
});
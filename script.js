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
            paper: "Data/Papers/AMES_Portfolio_Optimization.pdf",
            code: "Data/Papers/SCDLDS_Documentation.pdf"
        }
    },
    {
        title: "Documentation for Portfolio Optimization",
        venue: "(Working Documentation)",
        year: 2026,
        citations: 0,
        type: "conference",
        links: {
            paper: "Data/Papers/SCDLDS_Documentation.pdf",
            // code: "#",
            // slides: "#"
        }
    }//,
    // {
    //     title: "Attention Mechanisms in Transformers",
    //     venue: "IEEE Trans. PAMI",
    //     year: 2023,
    //     citations: 78,
    //     type: "journal",
    //     links: {
    //         paper: "#"
    //     }
    // },
    // {
    //     title: "Efficient Training of Large Scale Models",
    //     venue: "ICML 2023",
    //     year: 2023,
    //     citations: 35,
    //     type: "conference",
    //     links: {
    //         paper: "#",
    //         code: "#"
    //     }
    // },
    // {
    //     title: "Advances in Few-Shot Learning",
    //     venue: "arXiv",
    //     year: 2024,
    //     citations: 8,
    //     type: "preprint",
    //     links: {
    //         paper: "#"
    //     }
    // }
];

// Set last updated date
function setLastUpdated() {
    const date = new Date();
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    const target = document.getElementById('lastUpdated');
    if (target) {
        target.textContent = date.toLocaleDateString('en-US', options);
    }
}

// Populate publications table
function populateTable(tableId, data) {
    const tbody = document.getElementById(tableId);
    if (!tbody) return;
    tbody.innerHTML = '';

    data.forEach(pub => {
        const row = document.createElement('tr');
        
        const linksHtml = Object.entries(pub.links)
            .map(([key, url]) => `<a href="${url}" class="link">${key.charAt(0).toUpperCase() + key.slice(1)}</a>`)
            .join(' • ');

        row.innerHTML = `
            <td><strong>${pub.title}</strong></td>
            <td>${pub.year}</td>
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
    const normalizedType = {
        conferences: 'conference',
        journals: 'journal',
        preprints: 'preprint'
    }[type] || type;
    return publicationsData.filter(pub => pub.type === normalizedType);
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
    initScrollReveal();
    initHeroPreview();
    initPointerTilt();
    loadDynamicFactorTable();
});

function initScrollReveal() {
    const revealItems = document.querySelectorAll('.section, .visual-shell');
    if (!('IntersectionObserver' in window)) {
        revealItems.forEach(item => item.classList.add('is-visible'));
        return;
    }

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12 });

    revealItems.forEach(item => {
        item.classList.add('reveal-item');
        observer.observe(item);
    });
}

function initHeroPreview() {
    const shell = document.querySelector('.visual-shell');
    const controls = document.querySelectorAll('.visual-mode');
    if (!shell || controls.length === 0) return;

    controls.forEach(control => {
        control.addEventListener('click', () => {
            window.setVisualPreview(control.dataset.preview || 'long_only');
        });
    });
}



function initPointerTilt() {
    const shell = document.querySelector('.visual-shell');
    if (!shell || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    shell.addEventListener('pointermove', event => {
        if (window.innerWidth < 980) return;

        const rect = shell.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;

        shell.style.setProperty('--tilt-x', `${4 - y * 5}deg`);
        shell.style.setProperty('--tilt-y', `${-6 + x * 7}deg`);
    });

    shell.addEventListener('pointerleave', () => {
        shell.style.removeProperty('--tilt-x');
        shell.style.removeProperty('--tilt-y');
    });
}

function downloadFile(filename) {
    const link = document.createElement('a');
    link.href = filename;
    link.download = filename;
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

document.addEventListener("DOMContentLoaded", function () {
    const triggers = document.querySelectorAll(".factor-tooltip-trigger");

    triggers.forEach(trigger => {
        trigger.addEventListener("click", function (e) {
            const isOpen = this.classList.contains("tooltip-open");

            triggers.forEach(item => item.classList.remove("tooltip-open"));

            if (!isOpen) {
                this.classList.add("tooltip-open");
            }

            e.stopPropagation();
        });
    });

    document.addEventListener("click", function () {
        triggers.forEach(item => item.classList.remove("tooltip-open"));
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
            triggers.forEach(item => item.classList.remove("tooltip-open"));
        }
    });
});

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

async function loadDynamicFactorTable() {
    try {
        const fetchUrl = 'factor_table.csv?v=' + new Date().getTime();
        const response = await fetch(fetchUrl);
        if (!response.ok) return;
        const csvText = await response.text();
        
        const lines = csvText.trim().split(/\r?\n/);
        if (lines.length < 2) return;
        
        const headers = lines[0].split(',');
        const latestMonth = headers[1];
        
        const thead = document.getElementById('dynamic-factor-thead');
        if (thead) {
            thead.innerHTML = `
                <tr>
                    <th></th>
                    <th>${latestMonth}<br><span style="font-size: 0.8em; font-weight: 500; color: #64748b;">(Returns %)</span></th>
                    <th>Last 3 Months<br><span style="font-size: 0.8em; font-weight: 500; color: #64748b;">(Returns %)</span></th>
                    <th>Last 12 Months<br><span style="font-size: 0.8em; font-weight: 500; color: #64748b;">(Returns %)</span></th>
                    <th></th>
                </tr>
            `;
        }
        
        const tooltips = {
            'Rm-Rf (Using Nifty 500)': 'Rm-Rf = Market Risk Premium. Measures the excess return of the market portfolio over the risk-free rate.',
            'SMB': 'SMB = Small Minus Big. Measures the size factor: small-cap stocks minus large-cap stocks.',
            'HML': 'HML = High Minus Low. Measures the value factor: high book-to-market stocks minus low book-to-market stocks.',
            'WML': 'WML = Winners Minus Losers. Measures the momentum factor: past winners minus past losers.',
            'RMW': 'RMW = Robust Minus Weak. Measures the operating profitability factor: robust vs weak operating profitability.',
            'CMA': 'CMA = Conservative Minus Aggressive. Measures the investment factor: conservative vs aggressive investment.',
            'AT (Asset Turnover)': 'AT = Asset Turnover. Measures the asset turnover factor: high vs low asset turnover.',
            'SG (Sales Growth)': 'SG = Sales Growth. Measures the sales growth factor: high vs low sales growth.',
            'ACC (Accruals)': 'ACC = Accruals. Measures the accruals factor: conservative vs aggressive accruals.'
        };

        const factorCodeMap = {
            'Rm-Rf (Using Nifty 500)': 'MKT',
            'SMB': 'SMB',
            'HML': 'HML',
            'WML': 'WML',
            'RMW': 'RMW',
            'CMA': 'CMA',
            'AT (Asset Turnover)': 'AT',
            'SG (Sales Growth)': 'SG',
            'ACC (Accruals)': 'ACC'
        };
        
        const tbody = document.getElementById('dynamic-factor-tbody');
        if (tbody) {
            let html = '';
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',');
                if (cols.length < 4) continue;
                
                const factor = cols[0];
                const val1m = parseFloat(cols[1]);
                const val3m = parseFloat(cols[2]);
                const val12m = parseFloat(cols[3]);
                
                const getCls = (v) => isNaN(v) ? '' : (v >= 0 ? 'positive' : 'negative');
                const formatVal = (v, str) => isNaN(v) ? str : (v > 0 ? '+' + str + '%' : str + '%');
                const fcode = factorCodeMap[factor] || factor;
                
                html += `
                    <tr>
                        <td class="factor-name">
                            <span class="factor-tooltip-trigger" tabindex="0" data-tooltip="${tooltips[factor] || factor}">
                                ${factor}
                            </span>
                        </td>
                        <td class="${getCls(val1m)}">${formatVal(val1m, cols[1])}</td>
                        <td class="${getCls(val3m)}">${formatVal(val3m, cols[2])}</td>
                        <td class="${getCls(val12m)}">${formatVal(val12m, cols[3])}</td>
                        <td><a href="backtester.html?factor=${fcode}" class="analyze-link">Analyze &rarr;</a></td>
                    </tr>
                `;
            }
            tbody.innerHTML = html;
        }
    } catch (error) {
        console.error("Error loading dynamic factor table:", error);
    }
}

window.setVisualPreview = function setVisualPreview(mode) {
    const shell = document.querySelector('.visual-shell');
    const controls = document.querySelectorAll('.visual-mode');
    const panels = document.querySelectorAll('.visual-panel');
    if (!shell || controls.length === 0) return;

    const nextMode = mode || 'long_only';
    shell.dataset.focus = nextMode;
    
    controls.forEach(control => {
        control.classList.toggle('active', control.dataset.preview === nextMode);
    });
    
    panels.forEach(panel => {
        if (panel.dataset.panel === nextMode) {
            panel.style.display = 'block';
        } else {
            panel.style.display = 'none';
        }
    });
};

function initPointerTilt() {
    const shell = document.querySelector('.visual-shell');
    if (!shell || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    shell.addEventListener('pointermove', event => {
        if (window.innerWidth < 980) return;

        const rect = shell.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;

        shell.style.setProperty('--tilt-x', `${4 - y * 5}deg`);
        shell.style.setProperty('--tilt-y', `${-6 + x * 7}deg`);
    });

    shell.addEventListener('pointerleave', () => {
        shell.style.removeProperty('--tilt-x');
        shell.style.removeProperty('--tilt-y');
    });
}

function downloadFile(filename) {
    const link = document.createElement('a');
    link.href = filename;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

document.addEventListener('DOMContentLoaded', initPointerTilt);

// ── Horizontal Scroll Tabs Logic ──
document.addEventListener('DOMContentLoaded', () => {
    const tabsContainer = document.querySelector('.tabs-container');
    if (!tabsContainer) return;
    const tabs = tabsContainer.querySelector('.tabs');
    const leftFade = tabsContainer.querySelector('.scroll-fade.left');
    const rightFade = tabsContainer.querySelector('.scroll-fade.right');
    
    function updateScrollFades() {
        if (!tabs || !leftFade || !rightFade) return;
        if (tabs.scrollLeft > 0) {
            leftFade.classList.remove('hidden');
        } else {
            leftFade.classList.add('hidden');
        }
        if (tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 1) {
            rightFade.classList.add('hidden');
        } else {
            rightFade.classList.remove('hidden');
        }
    }
    
    tabs.addEventListener('scroll', updateScrollFades);
    window.addEventListener('resize', updateScrollFades);
    setTimeout(updateScrollFades, 100);
});

function scrollTabs(direction) {
    const tabs = document.querySelector('.tabs-container .tabs');
    if (tabs) {
        tabs.scrollBy({ left: direction * 300, behavior: 'smooth' });
    }
}

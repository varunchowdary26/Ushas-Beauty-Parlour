/* =========================================================
   Glow & Grace / Ushas Herbal Beauty Parlour
   Flask API Frontend Integration
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    // Navigation & Button Click Wave (Transparent black layer travels left to right)
    document.querySelectorAll('.navbar nav a, .back-home, .switch-pill, .promo-action-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            this.classList.remove('sweep-active');
            void this.offsetWidth;
            this.classList.add('sweep-active');
            setTimeout(() => this.classList.remove('sweep-active'), 600);
        });
    });

    // 1. Booking Form Handler
    const bookingForm = document.getElementById("bookingForm");
    if (bookingForm) {
        const dateInput = document.getElementById("appointmentDate");
        if (dateInput) {
            dateInput.min = new Date().toISOString().split("T")[0];
        }

        bookingForm.addEventListener("submit", async function(e) {
            e.preventDefault();

            const serviceElement = document.getElementById("service");
            const selectedOption = serviceElement ? serviceElement.options[serviceElement.selectedIndex] : null;
            const chosenService = serviceElement ? serviceElement.value : "";
            const servicePriceMap = {
                "Facial": 500,
                "Tan Pack": 400,
                "Manicure & Pedicure": 600,
                "Bridal Makeup": 5000,
                "Saree Draping": 200,
                "Party Makeup": 1500
            };
            const chosenPrice = Number(
                selectedOption && selectedOption.dataset.price
                    ? selectedOption.dataset.price
                    : (servicePriceMap[chosenService] || 0)
            );

            const payload = {
                name: document.getElementById("customerName")?.value.trim() || "",
                phone: document.getElementById("customerPhone")?.value.trim() || "",
                email: document.getElementById("customerEmail")?.value.trim() || "",
                service: chosenService,
                price: chosenPrice,
                date: document.getElementById("appointmentDate")?.value || "",
                time: document.getElementById("appointmentTime")?.value || "",
                notes: document.getElementById("notes")?.value.trim() || ""
            };

            if (!/^[0-9]{10}$/.test(payload.phone)) {
                alert("Please enter a valid 10-digit phone number.");
                return;
            }

            // Create fallback booking object with unique ID
            const bookingId = "UB-" + Math.floor(100000 + Math.random() * 900000);
            let finalBooking = {
                id: bookingId,
                name: payload.name,
                phone: payload.phone,
                email: payload.email,
                service: payload.service,
                price: payload.price,
                date: payload.date,
                time: payload.time,
                notes: payload.notes,
                status: "Confirmed",
                created_at: new Date().toISOString()
            };

            // Attempt to sync with Flask backend if available (safely handles Live Server)
            try {
                const response = await fetch('/api/bookings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const contentType = response.headers.get("content-type") || "";
                if (response.ok && contentType.includes("application/json")) {
                    const result = await response.json();
                    if (result && result.booking) {
                        finalBooking = result.booking;
                    }
                }
            } catch (networkErr) {
                // Live Server (port 5500) or static server: gracefully save to localStorage
                console.info("Backend API not reachable; saving appointment locally.");
            }

            // Always save to localStorage for offline support & my-bookings.html lookup
            try {
                const localBookings = JSON.parse(localStorage.getItem('ushas_bookings')) || [];
                localBookings.unshift(finalBooking);
                localStorage.setItem('ushas_bookings', JSON.stringify(localBookings));
            } catch (storageErr) {
                console.error("Local storage error:", storageErr);
            }

            showSuccessModal(finalBooking);
            bookingForm.reset();
        });
    }

    // 2. Customer Search Handler
    const lookupForm = document.getElementById("searchForm");
    const searchBtn = document.getElementById("searchBtn");

    if (lookupForm) {
        lookupForm.addEventListener("submit", e => { e.preventDefault(); performCustomerSearch(); });
    } else if (searchBtn) {
        searchBtn.addEventListener("click", performCustomerSearch);
    }

    // 3. Admin Dashboard Handler
    const bookingsTable = document.getElementById("bookingsTable");
    if (bookingsTable) {
        const monthFilter = document.getElementById("monthFilter");
        const searchInput = document.getElementById("searchBookings");

        if (monthFilter) {
            const now = new Date();
            monthFilter.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            monthFilter.addEventListener("change", updateDashboard);
        }
        if (searchInput) searchInput.addEventListener("input", updateDashboard);

        updateDashboard();
    }
});

// Modal UI Control
function showSuccessModal(booking) {
    const modal = document.getElementById("successModal");
    const summary = document.getElementById("appointmentSummary");
    if (!modal || !summary) return;

    summary.innerHTML = `
        <p><strong>Booking ID:</strong> <span style="color: #d94f7d;">${escapeHTML(booking.id)}</span></p>
        <p><strong>Name:</strong> ${escapeHTML(booking.name)}</p>
        <p><strong>Service:</strong> ${escapeHTML(booking.service)}</p>
        <p><strong>Date & Time:</strong> ${formatDate(booking.date)} at ${formatTime(booking.time)}</p>
        <p><strong>Phone:</strong> ${escapeHTML(booking.phone)}</p>
    `;
    modal.classList.add("show");
}

function closeModal() {
    const modal = document.getElementById("successModal");
    if (modal) modal.classList.remove("show");
}

// Search Logic (Backend + LocalStorage Hybrid)
async function performCustomerSearch() {
    const queryInput = document.getElementById("searchPhoneInput") || document.getElementById("searchInput") || document.getElementById("searchBookings");
    const resultsContainer = document.getElementById("searchResults") || document.getElementById("resultsContainer") || document.getElementById("emptyBookings");

    if (!queryInput || !resultsContainer) return;
    const query = queryInput.value.trim().toLowerCase();
    if (!query) return alert("Please enter a phone number or Booking ID.");

    let matches = [];
    let fetchedFromServer = false;

    try {
        const response = await fetch(`/api/bookings/search?q=${encodeURIComponent(query)}`);
        const contentType = response.headers.get("content-type") || "";
        if (response.ok && contentType.includes("application/json")) {
            matches = await response.json();
            fetchedFromServer = true;
        }
    } catch (err) {
        // Fallback to local storage (e.g. on Live Server)
    }

    if (!fetchedFromServer) {
        const localBookings = JSON.parse(localStorage.getItem('ushas_bookings')) || [];
        matches = localBookings.filter(b => 
            (b.phone && b.phone.toLowerCase().includes(query)) ||
            (b.id && b.id.toLowerCase().includes(query)) ||
            (b.name && b.name.toLowerCase().includes(query))
        );
    }

    resultsContainer.style.display = "block";
    if (!matches || matches.length === 0) {
        resultsContainer.innerHTML = `<p class="no-results" style="padding: 20px; text-align: center;">No bookings found matching <strong>${escapeHTML(query)}</strong>.</p>`;
        return;
    }

    resultsContainer.innerHTML = matches.map(b => `
        <div class="booking-card" style="border: 1px solid #eee; border-left: 5px solid #d94f7d; padding: 15px; border-radius: 6px; margin-bottom: 15px; background: #fff;">
            <h3 style="margin-bottom: 8px; color: #241b20;">${escapeHTML(b.service)}</h3>
            <p><strong>Booking ID:</strong> <span style="color: #d94f7d; font-weight:700;">${escapeHTML(b.id)}</span></p>
            <p><strong>Name:</strong> ${escapeHTML(b.name)}</p>
            <p><strong>Phone:</strong> ${escapeHTML(b.phone)}</p>
            <p><strong>Date & Time:</strong> ${formatDate(b.date)} at ${formatTime(b.time)}</p>
            ${b.price ? `<p><strong>Price:</strong> ${formatCurrency(b.price)}</p>` : ""}
        </div>
    `).join("");
}

// Dashboard Refresh Logic (Backend + LocalStorage Hybrid)
async function updateDashboard() {
    const month = document.getElementById("monthFilter")?.value || "";
    const search = (document.getElementById("searchBookings")?.value || "").trim().toLowerCase();

    let filtered = [];
    let fetchedFromServer = false;

    try {
        const response = await fetch(`/api/bookings?month=${encodeURIComponent(month)}&search=${encodeURIComponent(search)}`);
        const contentType = response.headers.get("content-type") || "";
        if (response.ok && contentType.includes("application/json")) {
            filtered = await response.json();
            fetchedFromServer = true;
        }
    } catch (err) {
        // Fallback to local storage (e.g. on Live Server)
    }

    if (!fetchedFromServer) {
        const localBookings = JSON.parse(localStorage.getItem('ushas_bookings')) || [];
        filtered = localBookings.filter(b => {
            const matchesMonth = month ? (b.date && b.date.startsWith(month)) : true;
            const matchesSearch = search ? (
                (b.name && b.name.toLowerCase().includes(search)) ||
                (b.phone && b.phone.toLowerCase().includes(search)) ||
                (b.service && b.service.toLowerCase().includes(search)) ||
                (b.id && b.id.toLowerCase().includes(search))
            ) : true;
            return matchesMonth && matchesSearch;
        });
    }

    updateStats(filtered);
    updateServiceAnalytics(filtered);
    updateSummary(filtered);
    updateBookingsTable(filtered);
}

function updateStats(bookings) {
    const totalBookings = document.getElementById("totalBookings");
    if (!totalBookings) return;

    totalBookings.textContent = bookings.length;
    document.getElementById("totalCustomers").textContent = new Set(bookings.map(b => b.phone)).size;

    const revenue = bookings.reduce((sum, b) => sum + Number(b.price || 0), 0);
    const totalRevenue = document.getElementById("totalRevenue");
    if (totalRevenue) totalRevenue.textContent = formatCurrency(revenue);

    const counts = getServiceCounts(bookings);
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const topService = document.getElementById("topService");
    if (topService) topService.textContent = sorted.length ? sorted[0][0] : "None";
}

function getServiceCounts(bookings) {
    const counts = {};
    bookings.forEach(b => counts[b.service] = (counts[b.service] || 0) + 1);
    return counts;
}

function updateServiceAnalytics(bookings) {
    const container = document.getElementById("serviceAnalytics");
    if (!container) return;

    const counts = getServiceCounts(bookings);
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (!sorted.length) {
        container.innerHTML = `<div style="text-align:center;padding:20px;">No booking data available.</div>`;
        return;
    }

    const max = sorted[0][1];
    container.innerHTML = sorted.map(([service, count]) => `
        <div style="margin-bottom:10px;">
            <span>${escapeHTML(service)} (${count})</span>
            <div style="background:#f0f0f0; border-radius:4px; height:8px; width:100%;">
                <div style="width:${Math.round((count/max)*100)}%; background:#d94f7d; height:100%;"></div>
            </div>
        </div>
    `).join("");
}

function updateSummary(bookings) {
    const summary = document.getElementById("summaryInsight");
    if (!summary) return;

    if (!bookings.length) {
        summary.innerHTML = `<p>No booking insights available for this selection.</p>`;
        return;
    }
    const revenue = bookings.reduce((sum, b) => sum + Number(b.price || 0), 0);
    summary.innerHTML = `<p>Total Revenue: <strong>${formatCurrency(revenue)}</strong> over <strong>${bookings.length}</strong> bookings.</p>`;
}

function updateBookingsTable(bookings) {
    const table = document.getElementById("bookingsTable");
    const empty = document.getElementById("emptyBookings");
    if (!table) return;

    if (!bookings.length) {
        table.innerHTML = "";
        if (empty) empty.style.display = "block";
        return;
    }

    if (empty) empty.style.display = "none";
    table.innerHTML = bookings.map(b => `
        <tr>
            <td><strong>${escapeHTML(b.name)}</strong><br><small style="color:#e91e63">ID: ${escapeHTML(b.id)}</small></td>
            <td>${escapeHTML(b.phone)}</td>
            <td>${escapeHTML(b.service)}</td>
            <td>${formatDate(b.date)}</td>
            <td>${formatTime(b.time)}</td>
            <td><strong>${formatCurrency(b.price)}</strong></td>
        </tr>
    `).join("");
}

function exportCSV() {
    const localBookings = JSON.parse(localStorage.getItem('ushas_bookings')) || [];
    if (!localBookings.length) {
        window.location.href = '/api/export/csv';
        return;
    }
    const headers = ["Booking ID", "Customer Name", "Phone", "Email", "Service", "Price", "Date", "Time", "Notes", "Status"];
    const rows = localBookings.map(b => [
        b.id || "",
        `"${(b.name || "").replace(/"/g, '""')}"`,
        b.phone || "",
        b.email || "",
        `"${(b.service || "").replace(/"/g, '""')}"`,
        b.price || 0,
        b.date || "",
        b.time || "",
        `"${(b.notes || "").replace(/"/g, '""')}"`,
        b.status || "Confirmed"
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ushas_bookings_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);
}

function formatDate(dateString) {
    if (!dateString) return "-";
    const parts = dateString.split("-");
    return parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : dateString;
}

function formatTime(timeString) {
    if (!timeString) return "-";
    const [h, m] = timeString.split(":");
    const d = new Date(); d.setHours(Number(h), Number(m));
    return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function escapeHTML(v) {
    return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
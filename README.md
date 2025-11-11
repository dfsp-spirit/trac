# o-timeusediary-backend
The fastpi backend for the custom o-timeusediary (TUD) fork of MPIAE.


## About

This is a Python/FastAPI backend that stores data submitted by participants who filled out our adapted version of o-timeusediary. The o-timeusediary is basically a web form that allows users how, with whom, where, etc, they spend their time on a specific day.

By default, o-timeusediary supports download the data as a CSV file onto the client (participant) computer, or sending it to a datapipe/Open Science Foundataion account, so it works without the need to run a backend server. That is a great thing in general, but for our usecase however, we need to store the data on institute servers. This is where this backend comes in.

What we did is we modified the frontend to also support:

* sending the data as JSON to this backend
* loading and displaying data from the backend, e.g., to support editing existing data or reduce the amount of work required to fill in the diary for many days.



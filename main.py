
from fastapi import FastAPI
import pandas as pd
from pydantic import BaseModel, Field
from typing import Literal
import joblib

from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware




ml_model = {}


@asynccontextmanager
async def lifespan(app: FastAPI):

    model_package = joblib.load("random_forest_loan_model.pkl")

    ml_model["model"] = model_package["model"]
    ml_model["threshold"] = model_package["threshold"]

    yield

    ml_model.clear()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "https://loanrisk-classifier-1.onrender.com",
],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Input validation
class UserData(BaseModel):

    person_age: int = Field(..., ge=18)

    person_income: float = Field(..., ge=0)

    person_home_ownership: Literal[
        "RENT", "MORTGAGE", "OWN", "OTHER"
    ]

    person_emp_length: float = Field(..., ge=0)

    loan_intent: Literal[
        "EDUCATION", "MEDICAL", "VENTURE",
        "PERSONAL", "DEBTCONSOLIDATION",
        "HOMEIMPROVEMENT"
    ]

    loan_grade: Literal["A", "B", "C", "D", "E", "F", "G"]

    loan_amnt: float = Field(..., ge=0)

    loan_int_rate: float = Field(..., ge=0)

    loan_percent_income: float = Field(..., ge=0, le=1)

    cb_person_default_on_file: Literal["Y", "N"]

    cb_person_cred_hist_length: int = Field(..., ge=0)


@app.get("/")
def greet():

    return {
        "message": "Welcome to the Loan Default Prediction API"
    }


@app.post("/predict")
def predict(data: UserData):

    input_data = pd.DataFrame([data.model_dump()])

    model = ml_model["model"]
    threshold = ml_model["threshold"]

    # Probability prediction
    probability = model.predict_proba(input_data)[0][1]

    # Apply 0.40 threshold
    prediction = int(probability >= threshold)

    return {
        "prediction": prediction,
        "risk_status": "Risky Borrower" if prediction == 1 else "Low Risk Borrower",
        "risk_probability": round(float(probability * 100), 2),
        "threshold": threshold
    }

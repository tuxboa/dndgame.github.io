/*
  * Copyright 2009 Udo Schroeter <udo.schroeter@gmail.com>
  *
  * Redistribution and use in source and binary forms, with or without
  * modification, are permitted provided that the following conditions
  * are met:
  * 1. Redistributions of source code must retain the above copyright  
  *    notice, this list of conditions and the following disclaimer.
  * 2. Redistributions in binary form must reproduce the above copyright
  *    notice, this list of conditions and the following disclaimer in the
  *    documentation and/or other materials provided with the distribution.
  *
  * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
  * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
  * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
  * IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
  * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
  * NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/* File: DiceParser.cs
 * Classes: 
 *   DiceInstruction - an atomic part of a die rolling code containing an expression
 *   DiceParser - parses and evaluates die codes (limitation: linear parsing, does not honor operator precedence)
 * */

using System;
using System.Text.RegularExpressions;
using System.Collections.Generic;

namespace DiceRoller
{
	
	public class DiceInstruction
	{
		string instruction, varname = "";
		List<int>dieSides = new List<int>();
		int diceCount, modifierNumber = 0;
		char modifier = '\0';
		char rollType = 'c';
		int pSign = 1;
		Dictionary<string, int> varTable = null;
		
		/* An instruction is created by the DiceParser class while a dice code line is being parsed.
		 * The constructor takes the actual instruction as a string token, a modifier signed int that
		 * determines whether the expression result should be evaluated as a negative (this is a crutch
		 * since we don't have real operators or a parse tree for that matter), and a reference to the
		 * current variable table.
		 * */
		public DiceInstruction(string instruct, int sign, Dictionary<string, int> varTab)
		{
			instruction = instruct;
			pSign = sign;
			varTable = varTab;
			// we need to figure out what kind of instruction we are
			foreach(string token in Tokenize(instruction))
			{
				string tt = token.Trim().ToLower();
				if(!tt.Equals("")) try
				{
					// if this part is a number...
					int cNumber = int.Parse("0"+tt);
					if(diceCount == 0) 
						diceCount = cNumber;
				    else if(modifier != '\0')
						modifierNumber = cNumber;
					else
						dieSides.Add(cNumber);
				}
				catch
				{
					// if it's not a number...
					bool done = false;
					if(tt.Length == 1) 
					{
						if(rollType == 'c')
						{
							switch(tt)
							{
							case("d"): case("l"): case("h"): case("u"):
								rollType = tt[0];
								done = true;
								break;
							}
						}
						else if(modifier == '\0')
						{
							switch(tt)
							{
							case("e"): case("r"): case("f"): case("m"): case("s"):
								modifier = tt[0];
								done = true;
								break;
							}
						}
					}
					if(!done && tt[0] != ':')
					{
						// if this is not a number and neither a die code nor a modifier, it must be a variable
						varname = tt;
						rollType = 'v';
					}
				}
			}
			/* debug output while parsing
			Console.Write(" - > new "+instruction+": count="+diceCount.ToString()+" type="+sign.ToString()+rollType);
			if(dieSides.Count > 0) foreach(int side in dieSides) 
				Console.Write(" side="+side.ToString());
			if(modifier != '\0')
				Console.Write(" mod="+modifier+" mnum="+modifierNumber.ToString());
			if(varname.Length > 0)
				Console.Write(" var="+varname);
			Console.WriteLine(" ("+instruct+")"); */
		}
		
		public static string[] Tokenize(string equation)
		{
		   Regex RE = new Regex(@"([a-z\:])");
		   return (RE.Split(equation));
		}

		public int eval(int preValue, List<string> errorLog)
		{
			Random rand = new Random();
			int myValue = 0;
			//Console.Write("["+rollType+"] eval: "+instruction+" ");
			switch(rollType)
			{
			case 'c':
				myValue = preValue + (diceCount*pSign);
				break;
			case 'd':
				for(int rc = 1; rc <= diceCount; rc++)
				{
				  	int thisRoll = 0;
					foreach(int side in dieSides) 
					{
						int dieResult = rand.Next(1, side+1);
						switch(modifier)
						{
						case('r'):
						case('s'):
							if(dieResult == side)
							{
								int reResult = 0;
								do 
								{
									reResult = rand.Next(1, side+1);
									dieResult += reResult;
								} while (reResult == side);
							}
							break;
						}
						thisRoll += dieResult;						
					}
					switch(modifier)
					{
					case('f'):
					case('s'):
						if(thisRoll == 1) myValue--;
						else if(thisRoll >= modifierNumber) myValue++;
						break;
					case('e'): case('r'):
						if(thisRoll >= modifierNumber) myValue++;
						break;
					default:
						myValue += thisRoll;
						break;
					}
				}
				errorLog.Add("Result: "+instruction+'='+myValue);
				//Console.Write("= "+myValue.ToString());
				myValue += preValue;
				break;
			case 'v':
				try
				{
					myValue = preValue + (varTable[varname]*pSign);
					//Console.Write("= "+(varTable[varname]*pSign).ToString());
				}
				catch
				{
					myValue = preValue;
					//Console.Write("= 0 (unknown)");
					errorLog.Add("Warning: unknown variable "+varname);
				}
				break;
			default:
			    myValue = preValue;
				break;
			}
			//Console.WriteLine("");
			return(myValue);
		}
	}
	
	public class DiceParser
	{
		// original code that was parsed
		public string currentCode = "";
		// plain list of all the expressions
		private List<DiceInstruction>diList = new List<DiceInstruction>();
		// the variable table, fill this with your variables (names in lower case)
		public Dictionary<string, int> varTable = new Dictionary<string, int>();
		// log of operations
		public List<string>errorLog = new List<string>();
		
		public DiceParser ()
		{
		}
		
		// dissects a line of die code into individual expressions
		public static string[] Tokenize(string equation)
		{
		   Regex RE = new Regex(@"([\+\-\*\(\)\^\\])");
		   return (RE.Split(equation));
		}
		
		// parses a dice code, for syntax reference go to: http://rpgp.org/dice
		public void parse(String diceCode)
		{
		    currentCode = diceCode;
			int sign = 1;
			foreach(string token in Tokenize(currentCode))
			{
				string tt = token.Trim();
				if(tt.Equals("+")) sign = 1; // no op
				else if(tt.Equals("-")) sign = -1;
				else if(tt.Length > 0)
				{
					diList.Add(new DiceInstruction(tt, sign, varTable));
					sign = 1;
				}
			}
		}
		
		// evaluates the currently parsed expression
		public int roll()
		{
			errorLog.Clear();
			int result = 0;
			foreach(DiceInstruction di in diList)
			{
				result = di.eval(result, errorLog);
			}
			return(result);
		}
	}

}

